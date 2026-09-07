// Runs on your own machine, in your own browser, with you in the loop.
//
// Why this exists: the cloud version can only tell you space appeared. This
// one does everything up to the captcha and then stops with the page ready,
// so your entire job is to tick the box and press Add to Cart.
//
// It also just works better from home. reCAPTCHA weighs where a request comes
// from, and a datacenter address gets the hard image grid nearly every time,
// while an ordinary home connection in an ordinary browser usually gets the
// one-click checkbox. Nothing here tries to dodge the captcha; a human still
// solves it. It simply runs where a human actually is.
//
//   npm run local              watch continuously for cancellations
//   npm run local -- --at "2026-09-11T07:00:00"    wait for a release, then sprint
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
const releaseAt = args.includes('--at') ? args[args.indexOf('--at') + 1] : null;

const PROFILE = '.browser-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const banner = (msg) => {
  const line = '='.repeat(64);
  // The bell matters: you may not be looking at the screen.
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

// A real Chrome if there is one, otherwise the bundled browser. Both are fine;
// the point is that this is a visible window on your own connection.
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
    return chromium.launchPersistentContext(PROFILE, opts);
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

let pass = 0;
for (;;) {
  pass += 1;
  let found = [];
  try {
    found = await findAvailability(page, trip);
  } catch (e) {
    log(`check ${pass} failed: ${e.message.split('\n')[0]}`);
  }

  if (found.length) {
    const pick = found[0];
    banner(`SPACE FOUND: ${pick.depart} on ${pick.date} (${pick.label})\n`
      + `Selecting it now. Then TICK THE CAPTCHA and press ADD TO CART.`);

    // Fire the phone push too, in case you stepped away from the laptop.
    await notify({
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

    banner('OVER TO YOU. Tick "I am not a robot", then Add to Cart.\n'
      + 'This window stays open. Nothing else will be clicked for you.');
    // Deliberately stop. Anything further would be a machine answering a
    // question that is asked of a person.
    break;
  }

  const gap = releaseAt && msUntil(releaseAt) > -limits.sprintHardMs
    ? limits.sprintPollMs
    : limits.idlePollMs;
  if (pass % 10 === 1 || releaseAt) log(`check ${pass}: nothing yet`);
  await sleep(gap);
}
