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

// One retry, because the failure that matters happens two minutes before a
// release and a transient hiccup there costs the whole run.
// Held at module scope so the top-level handler can close it even when the
// failure happens before the main loop's own cleanup is in scope. Playwright
// keeps the event loop alive, so an unclosed browser turns a crash into a hang
// that runs until the job times out.
let browser = null;

async function withRetry(fn, what, attempts = 2) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      log(`${what}: attempt ${i} of ${attempts} failed — ${e.message.split('\n')[0]}`);
      if (i < attempts) await sleep(2000);
    }
  }
  throw last;
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

  const channels = [
    process.env.NTFY_TOPIC ? 'phone push (ntfy)' : null,
    process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY ? 'GitHub issue' : null,
  ].filter(Boolean);
  log(`alert channels: ${channels.join(' + ') || 'NONE — an alert would go nowhere'}`);
  if (!process.env.NTFY_TOPIC) {
    log('  no NTFY_TOPIC set. Since WSF blocks automated booking behind a captcha,');
    log('  a phone push is the only channel fast enough to be worth anything here.');
  }

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

  browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  const { findAvailability, prepareSearch } = await import('./lib/search.js');
  const { bookSailing } = await import('./lib/booking.js');
  const flow = await import('./lib/flow.js');

  // Sign in first. The account has a payment method saved, so an authenticated
  // session skips the slowest part of checkout. A failed login is not fatal
  // here — better to keep looking and report honestly than to bail — but it
  // does mean booking will not complete, so say so loudly.
  const auth = await withRetry(
    () => flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD),
    'sign in',
  ).catch((e) => ({ ok: false, reason: `sign-in threw: ${e.message.split('\n')[0]}` }));
  log(`login: ${auth.ok ? 'OK' : 'FAILED'} — ${auth.reason}`);
  // Deliberately not notifying here. The watch runs every fifteen minutes and
  // usually finds nothing, so a broken login would otherwise fire an alert on
  // every run for days. It only matters at the moment there is something to
  // take, so it is folded into the message sent then.

  // Load the search form and set everything that does not change, so the
  // moment the release lands we are one postback away from an answer.
  await withRetry(() => prepareSearch(page, trip), 'prime the search form');
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

        // Alert first, before anything else. WSF enforces a reCAPTCHA on the
        // booking step server-side — it rejects with "You need to pass
        // recaptcha challenge to Continue" and leaves the cart empty — so the
        // booking attempt below is expected to fail and its only value is
        // being wrong about that. The notification is the product, and every
        // second it waits is a second of a window measured in seconds.
        await notify({
          title: `GO NOW: ${pick.depart} on ${pick.date} is open`,
          body: `${pick.spacesText} on the ${pick.depart} sailing (${pick.vessel}), `
            + `${trip.from.name} to ${trip.to.name}, ${pick.date} — ${pick.label}.\n\n`
            + `Book it here, fast:\n`
            + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx\n\n`
            + `Orcas Island -> Anacortes, date ${pick.date}, vehicle under 22 feet, up to 7'2" tall.\n`
            + `Pick ${pick.depart}, tick the "I'm not a robot" box, then Add to Cart and check out.\n\n`
            + `WSF requires that captcha, so this part cannot be automated.`,
          priority: 'high',
        });

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
        // The expected outcome: WSF's captcha refused it. The alert is already
        // sent, so there is nothing useful left to say and no point retrying —
        // a second attempt fails identically and only burns the window.
        if (result.handoff) {
          log(`pass ${pass}: captcha refused it, as expected — ${result.reason}`);
          return;
        }

        // Anything else is a surprise worth a second look, but the human has
        // already been told to go, so keep it quiet and just record it.
        log(`pass ${pass}: booking attempt ${attempts} failed: ${result.reason}`);
        if (!auth.ok) log(`  (sign-in had also failed: ${auth.reason})`);
        if (attempts >= limits.maxBookingAttempts) return;
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
    await browser?.close();
    browser = null;
  }
}

// Nothing may fail quietly. A crash during warm-up would otherwise mean the
// release passes with no reservation and no word about why.
try {
  await main();
} catch (e) {
  const detail = e?.stack?.split('\n').slice(0, 4).join('\n') ?? String(e);
  console.error(detail);
  await notify({
    title: 'Ferry bot crashed - check it before the next release',
    body: `The ${MODE} run failed before it could finish.\n\n${detail}\n\n`
      + `Book by hand if a release is imminent: `
      + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx`,
    priority: 'high',
  }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
