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
import { trip, releases, limits } from './config.js';
import { nowPT, msUntil, humanDuration } from './lib/time.js';
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
  log(`route: ${trip.from.name} -> ${trip.to.name}, car under 22 feet`);
  for (const t of trip.targets) log(`  target: ${t.label} ${t.date} ${t.earliest}-${t.latest}`);

  let deadline = Date.now(); // when to stop looking
  if (MODE === 'snipe') {
    const rel = currentRelease();
    if (!rel) {
      log('no release is due within the hour; nothing to snipe. Exiting cleanly.');
      return;
    }
    log(`release: ${rel.wave} at ${rel.at} PT (${humanDuration(rel.ms)} away)`);

    // Wake a couple of seconds early so the first request is already in flight
    // when the inventory flips, rather than starting from a cold page load.
    const lead = 3000;
    if (rel.ms > lead) {
      log(`sleeping ${humanDuration(rel.ms - lead)} until just before the release`);
      await sleep(rel.ms - lead);
    }
    deadline = Date.now() + limits.sprintWindowMs;
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  const { findAvailability } = await import('./lib/search.js');
  const { bookSailing } = await import('./lib/booking.js');

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
            title: `Booked: ${pick.date} ${pick.depart} Orcas to Anacortes`,
            body: `Confirmation: ${result.confirmation ?? 'see the reservation site'}\n\n`
              + `Sailing: ${pick.depart} on ${pick.date} (${pick.label})\n`
              + `Check in at the tollbooth at least 30 minutes before departure, and arrive `
              + `45-60 minutes early. Remember the reservation is not a ticket; buy that at `
              + `the terminal or online.`,
            priority: 'high',
          });
          return;
        }
        log(`pass ${pass}: booking attempt ${attempts} failed: ${result.reason}`);
        if (attempts >= limits.maxBookingAttempts) {
          await notify({
            title: 'Space appeared but booking failed — go do it by hand now',
            body: `Saw ${pick.spacesText} on ${pick.date} ${pick.depart} but could not complete `
              + `the reservation after ${attempts} attempts.\n\nLast error: ${result.reason}\n\n`
              + `Book manually: https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx`,
            priority: 'high',
          });
          return;
        }
      } else {
        log(`pass ${pass}: nothing available`);
      }

      if (Date.now() >= deadline) break;
      await sleep(limits.sprintPollMs);
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
