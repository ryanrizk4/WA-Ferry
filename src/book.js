// The thing that actually runs.
//
// Two modes:
//
//   snipe  Started ~20 minutes before a known release by the scheduled
//          workflow, because Actions cron is queued and drifts. It waits out
//          the remaining time locally, so the first request lands within a
//          second or two of 7:00:00 a.m. Pacific rather than whenever the
//          runner happened to boot. Then it sprints for a short window.
//
//   watch  A single pass, for catching cancellations between releases.
//
// In both modes, finding space and booking it are the same code path. The only
// difference is how hard and how long it looks.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { trip, releases, limits, stopAfter } from './config.js';
import { nowPT, msUntil, humanDuration } from './lib/time.js';
import { alreadyBooked } from './lib/state.js';
import { notify } from './lib/notify.js';

const MODE = process.env.MODE === 'snipe' ? 'snipe' : 'watch';
const DRY_RUN = process.env.DRY_RUN === 'true';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync('out', { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The release we are here for: the next one still ahead of us, or one that
// fired within the sprint window (a late-starting runner must not give up).
function currentRelease() {
  const candidates = releases
    .map((r) => ({ ...r, ms: msUntil(r.at) }))
    .filter((r) => r.ms > -limits.sprintWindowMs && r.ms < 60 * 60_000)
    .sort((a, b) => a.ms - b.ms);
  return candidates[0] ?? null;
}

async function main() {
  log(`mode=${MODE} dryRun=${DRY_RUN} nowPT=${nowPT()}`);

  if (msUntil(stopAfter) < 0) {
    log(`travel window closed at ${stopAfter} PT; nothing left to do.`);
    return;
  }

  // A reservation already in hand means stop. Booking a second one just earns
  // a no-show fee on whichever goes unused.
  const prior = await alreadyBooked();
  if (prior.booked) {
    log(`already booked — "${prior.title}" (${prior.url}). Standing down.`);
    return;
  }
  if (!prior.known) log(`could not confirm whether we already booked: ${prior.reason}`);

  log(`route: ${trip.from.name} -> ${trip.to.name}, car under 22 feet`);
  for (const t of trip.targets) log(`  target: ${t.label} ${t.date} ${t.earliest}-${t.latest}`);

  let deadline = Date.now(); // when to stop looking
  let release = null;
  if (MODE === 'snipe') {
    release = currentRelease();
    if (!release) {
      log('no release is due within the hour; nothing to snipe. Exiting cleanly.');
      return;
    }
    log(`release: ${release.wave} at ${release.at} PT (${humanDuration(release.ms)} away)`);

    // Sit idle until shortly before the release, then warm up. Two minutes is
    // enough to sign in and load the search form, and short enough that the
    // session will not have gone stale by 7:00:00.
    const WARMUP_LEAD = 120_000;
    const idle = release.ms - WARMUP_LEAD;
    if (idle > 0) {
      log(`idling ${humanDuration(idle)}, then warming up ${humanDuration(WARMUP_LEAD)} early`);
      await sleep(idle);
    }
    deadline = Date.now() + limits.sprintWindowMs;
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  const { findAvailability, prepareSearch } = await import('./lib/search.js');
  const { bookSailing } = await import('./lib/booking.js');
  const flow = await import('./lib/flow.js');

  // Sign in first. The account has a payment method saved, so an authenticated
  // session skips the slowest part of checkout. A failed login is not fatal
  // here — better to keep looking and report honestly than to bail — but it
  // does mean booking will not complete, so say so loudly.
  const auth = await flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD);
  log(`login: ${auth.ok ? 'OK' : 'FAILED'} — ${auth.reason}`);
  // Deliberately not notifying here. The watch runs every twenty minutes and
  // usually finds nothing, so a broken login would otherwise fire an alert on
  // every run for days. It only matters at the moment there is something to
  // take, so it is folded into the message sent then.

  // Load the search form and set everything that does not change, so the
  // moment the release lands we are one postback away from an answer.
  await prepareSearch(page, trip);
  log('search form primed: route and vehicle set');

  if (release) {
    const remaining = msUntil(release.at);
    if (remaining > 0) {
      log(`primed with ${humanDuration(remaining)} to go; holding until the release`);
      await sleep(Math.max(0, remaining - 500));
    }
    deadline = Date.now() + limits.sprintWindowMs;
  }

  let attempts = 0;
  let pass = 0;
  try {
    do {
      pass += 1;
      let found = null;
      try {
        found = await findAvailability(page, trip);
      } catch (e) {
        log(`pass ${pass}: search failed: ${e.message.split('\n')[0]}`);
      }

      if (found?.length) {
        // findAvailability returns matches already ordered by our preference,
        // so the first one is the best sailing actually on offer.
        const pick = found[0];
        log(`pass ${pass}: SPACE FOUND — ${pick.date} ${pick.depart} (${pick.label}), ${pick.spacesText}`);

        if (DRY_RUN) {
          await notify({
            title: `Dry run: space open on ${pick.date} ${pick.depart}`,
            body: `Found ${pick.spacesText} on the ${pick.depart} sailing, ${trip.from.name} to `
              + `${trip.to.name}, ${pick.date}.\n\nThis was a dry run, so nothing was booked.`,
            priority: 'high',
          });
          return;
        }

        attempts += 1;
        const result = await bookSailing(page, pick, trip);
        if (result.ok) {
          await notify({
            title: `Booked: ${pick.date} ${pick.depart} Orcas to Anacortes`, // 'Booked:' prefix is the standdown marker
            body: `Confirmation: ${result.confirmation ?? 'see the reservation site'}\n\n`
              + `Sailing: ${pick.depart} on ${pick.date} (${pick.label})\n`
              + `Check in at the tollbooth at least 30 minutes before departure, and arrive `
              + `45-60 minutes early. Remember the reservation is not a ticket; buy that at `
              + `the terminal or online.`,
            priority: 'high',
          });
          return;
        }
        // A captcha is not a retryable error — trying again just burns the
        // seconds during which the space is still there. Hand it to a human
        // immediately, with everything they need to finish in one tap.
        if (result.handoff) {
          log(`pass ${pass}: handing off — ${result.reason}`);
          await notify({
            title: `GO NOW: ${pick.depart} on ${pick.date} is open`,
            body: `Space opened on the ${pick.depart} sailing from ${trip.from.name} to `
              + `${trip.to.name} on ${pick.date} (${pick.label}), vessel ${pick.vessel}.\n\n`
              + `${result.reason}. You need to finish this by hand, and fast:\n\n`
              + (auth.ok ? '' : `(Note: sign-in also failed — ${auth.reason})\n\n`)
              + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx\n\n`
              + `Orcas Island to Anacortes, ${pick.date}, vehicle under 22 feet, up to 7'2" tall. `
              + `Pick the ${pick.depart} sailing.`,
            priority: 'high',
          });
          return;
        }

        log(`pass ${pass}: booking attempt ${attempts} failed: ${result.reason}`);
        if (attempts >= limits.maxBookingAttempts) {
          await notify({
            title: 'Space appeared but booking failed — go do it by hand now',
            body: `Saw ${pick.spacesText} on ${pick.date} ${pick.depart} but could not complete `
              + `the reservation after ${attempts} attempts.\n\nLast error: ${result.reason}\n`
              + (auth.ok ? '' : `Sign-in also failed: ${auth.reason}\n`) + `\n`
              + `Book manually: https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx`,
            priority: 'high',
          });
          return;
        }
      } else {
        log(`pass ${pass}: nothing available`);
      }

      if (Date.now() >= deadline) break;
      if (MODE !== 'snipe') break; // watch mode is a single pass

      // Hard for the first minute, easier after. Sprint start is the deadline
      // minus the full window, so this measures time since the release.
      const sinceStart = Date.now() - (deadline - limits.sprintWindowMs);
      await sleep(sinceStart < limits.sprintHardMs
        ? limits.sprintPollMs
        : limits.sprintEasedPollMs);
    } while (Date.now() < deadline);

    log(`finished after ${pass} pass(es); no reservation made`);
    if (MODE === 'snipe') {
      await notify({
        title: 'Release came and went with nothing available',
        body: `Sprinted for ${humanDuration(limits.sprintWindowMs)} after the release and never `
          + `saw space on either target sailing. The cancellation watch keeps running.`,
        priority: 'normal',
      });
    }
  } finally {
    await browser.close();
  }
}

await main();
