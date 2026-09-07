// Runs on your own machine, in your own browser, with you in the loop.
//
// Why this exists: the cloud version can only tell you space appeared. This
// one does everything up to the captcha and then stops with the page ready,
// so your entire job is to tick the box and press Add to Cart.
//
//   npm run local
//       watch continuously for cancellations
//
//   npm run local -- --at "2026-09-11T07:00:00"
//       wait for an exact release, then sprint
//
//   npm run local -- --window "2026-09-13T17:00:00"
//       keep the normal watcher, but tighten polling from 20 minutes before
//       through 20 minutes after the named cancellation-window center
//
// Leave the window visible and the laptop awake and plugged in.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { trip, limits } from './config.js';
import { nowPT, msUntil, humanDuration } from './lib/time.js';
import { notify } from './lib/notify.js';
import * as flow from './lib/flow.js';
import { prepareSearch, findAvailability } from './lib/search.js';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const releaseAt = argValue('--at');
const windowAt = argValue('--window');
if (releaseAt && windowAt) {
  console.error('Use either --at for an exact release or --window for a cancellation window, not both.');
  process.exit(1);
}

const WINDOW_LEAD_MS = 20 * 60_000;
const WINDOW_FOLLOW_MS = 20 * 60_000;
const WINDOW_POLL_MS = 5_000;

const PROFILE = '.browser-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const banner = (msg) => {
  const line = '='.repeat(64);
  process.stdout.write('\x07');
  console.log(`\n${line}\n${msg}\n${line}\n`);
};

mkdirSync(PROFILE, { recursive: true });

if (!process.env.WSF_EMAIL || !process.env.WSF_PASSWORD) {
  console.error('Set WSF_EMAIL and WSF_PASSWORD first, for example:');
  console.error('  export WSF_EMAIL="you@example.com"');
  console.error('  export WSF_PASSWORD="..."');
  process.exit(1);
}

async function launch() {
  const opts = {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  };
  try {
    return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: 'chrome' });
  } catch {
    log('no system Chrome found, using the bundled browser instead');
  }
  try {
    return await chromium.launchPersistentContext(PROFILE, opts);
  } catch (e) {
    const missingBrowser = /Executable doesn't exist|please run.*install/i.test(e.message);
    console.error(`\n${'='.repeat(64)}`);
    console.error('Could not open a browser window.\n');
    if (missingBrowser) {
      console.error('The browser has not been downloaded yet. Run this once:\n');
      console.error('    npx playwright install chromium\n');
      console.error('then start this again.');
    } else {
      console.error(`${e.message.split('\n')[0]}\n`);
      console.error('If this machine has no desktop, run it somewhere with a screen:');
      console.error('this needs a visible window so you can tick the captcha.');
    }
    console.error('='.repeat(64));
    process.exit(1);
  }
}

const ctx = await launch();
const page = ctx.pages()[0] ?? await ctx.newPage();

log(`now ${nowPT()} Pacific`);
log(`route ${trip.from.name} -> ${trip.to.name}, car under 22 feet`);
for (const t of trip.targets) log(`  want ${t.label}: ${t.date} ${t.earliest}-${t.latest}`);

const auth = await flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD);
log(`sign in: ${auth.ok ? 'OK' : 'FAILED'} - ${auth.reason}`);

await prepareSearch(page, trip);
log('search form ready');

if (releaseAt) {
  const wait = msUntil(releaseAt);
  if (wait > 0) {
    banner(`Waiting for the ${releaseAt} Pacific release.\n`
      + `That is ${humanDuration(wait)} away. Leave this window open.\n`
      + `When space appears I will click the sailing and stop at the captcha.`);
    await sleep(Math.max(0, wait - 500));
  }
  banner('RELEASE TIME - sprinting now');
}

if (windowAt) {
  const untilWindowStart = msUntil(windowAt) - WINDOW_LEAD_MS;
  if (untilWindowStart > 0) {
    banner(`Focused cancellation window centered on ${windowAt} Pacific.\n`
      + `Normal setup is ready. Tight polling begins in ${humanDuration(untilWindowStart)}.`);
    await sleep(untilWindowStart);
  }
  banner(`FOCUSED CANCELLATION WINDOW ACTIVE\n`
    + `Center: ${windowAt} Pacific. Checking every ${WINDOW_POLL_MS / 1000} seconds\n`
    + `from 20 minutes before through 20 minutes after.`);
}

let pass = 0;
let consecutiveFailures = 0;
let lastHeartbeat = 0;
let windowEndAnnounced = false;

for (;;) {
  pass += 1;
  let found = [];
  try {
    found = await findAvailability(page, trip);
    consecutiveFailures = 0;
  } catch (e) {
    consecutiveFailures += 1;
    log(`check ${pass} failed (${consecutiveFailures} in a row): ${e.message.split('\n')[0]}`);

    if (consecutiveFailures >= 3) {
      log('rebuilding the session: signing in again and reloading the form');
      try {
        const again = await flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD);
        log(`  sign in: ${again.ok ? 'OK' : 'FAILED'} - ${again.reason}`);
        await prepareSearch(page, trip);
        log('  form rebuilt, carrying on');
        consecutiveFailures = 0;
      } catch (e2) {
        log(`  rebuild failed: ${e2.message.split('\n')[0]}`);
        if (consecutiveFailures >= 10) {
          banner('WATCH HAS STOPPED WORKING\n'
            + 'Ten checks in a row failed and signing in again did not help.\n'
            + 'Close this and start it again. Until you do, nothing is watching\n'
            + 'from this laptop.');
          await notify({
            title: 'Ferry watch on your laptop has stopped',
            body: 'The local watcher failed repeatedly and could not recover. '
              + 'Restart it, or rely on the cloud watcher until you do.',
            priority: 'high',
            issue: false,
          }).catch(() => {});
          process.exit(1);
        }
      }
    }
  }

  if (Date.now() - lastHeartbeat > 15 * 60_000) {
    lastHeartbeat = Date.now();
    log(`still watching. ${pass} checks so far, nothing open yet.`);
  }

  if (found.length) {
    const pick = found[0];
    banner(`SPACE FOUND: ${pick.depart} on ${pick.date} (${pick.label})\n`
      + `Selecting it now. Then TICK THE CAPTCHA and press ADD TO CART.`);

    // Start the phone push immediately but do not let notification-network
    // latency delay selecting the sailing in the already-open browser.
    const push = notify({
      title: `GO NOW: ${pick.depart} on ${pick.date} is open`,
      body: `The browser on your laptop is already on this sailing. Tick the `
        + `captcha and press Add to Cart.`,
      priority: 'high',
      issue: false,
    }).catch(() => {});

    try {
      await page.click(`#${pick.radioId}`, { timeout: 10000 });
    } catch (e) {
      log(`could not click the sailing: ${e.message.split('\n')[0]}`);
      log('do it by hand in the open window, it is on the right page');
    }

    await push;

    banner('OVER TO YOU. Tick "I am not a robot", then Add to Cart.\n'
      + 'This window stays open. Nothing else will be clicked for you.');
    break;
  }

  const releaseSprint = releaseAt && msUntil(releaseAt) > -limits.sprintHardMs;
  const windowOffset = windowAt ? msUntil(windowAt) : null;
  const focusedWindow = windowAt
    && windowOffset <= WINDOW_LEAD_MS
    && windowOffset >= -WINDOW_FOLLOW_MS;

  if (windowAt && !focusedWindow && windowOffset < -WINDOW_FOLLOW_MS && !windowEndAnnounced) {
    windowEndAnnounced = true;
    banner('Focused cancellation window finished. Returning to normal cancellation-watch cadence.');
  }

  const gap = releaseSprint
    ? limits.sprintPollMs
    : focusedWindow
      ? WINDOW_POLL_MS
      : limits.idlePollMs;

  if (pass % 10 === 1 || releaseAt || focusedWindow) log(`check ${pass}: nothing yet`);
  await sleep(gap);
}
