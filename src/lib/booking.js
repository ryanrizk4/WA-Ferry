// Turning an available sailing into a reservation.
//
// The flow WSF puts in front of us:
//   pick the sailing's radio -> "Add to Cart" -> checkout -> confirmation
//
// A hard rule runs through all of it: if a captcha is demanded, this stops and
// hands off to a human. Solving or slipping past the operator's anti-bot
// control is not something this does. Stopping is not a failure mode to be
// engineered away — it is the correct outcome, and the run still wins by
// having found the space and shouted about it within seconds.

import { writeFileSync } from 'node:fs';
import * as flow from './flow.js';

const BOOK_URL = 'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx';
const DRY_RUN = process.env.DRY_RUN === 'true';

const log = (...a) => console.log('  [book]', ...a);

async function dump(page, name) {
  try {
    writeFileSync(`out/${name}.html`, await page.content());
    await page.screenshot({ path: `out/${name}.png`, fullPage: true });
  } catch { /* diagnostics are best effort; never let them break a booking */ }
}

// Buttons are <a> and <div> soup here rather than real buttons, so match on
// visible text and fall back to anything whose id looks right.
async function clickByText(page, patterns, what) {
  for (const p of patterns) {
    const loc = page.getByText(p, { exact: false }).first();
    if (await loc.count().catch(() => 0)) {
      const label = (await loc.innerText().catch(() => '')).trim().slice(0, 40);
      log(`clicking ${what}: "${label}"`);
      await loc.click({ timeout: 10000 });
      await page.waitForTimeout(1500);
      return true;
    }
  }
  log(`could not find ${what} (tried ${patterns})`);
  return false;
}

export async function bookSailing(page, pick, trip) {
  log(`attempting ${pick.date} ${pick.depart} (${pick.vessel})`);

  // Select the sailing. The grid is rebuilt on every search, so the radio id
  // we captured is only good for the page as it stands right now.
  try {
    await page.click(`#${pick.radioId}`, { timeout: 10000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    return { ok: false, reason: `could not select the sailing: ${e.message.split('\n')[0]}` };
  }
  await dump(page, `book-1-selected-${pick.date}`);

  // The reservation summary should now name the sailing we asked for. If it
  // names a different one, the grid shifted under us between search and click
  // and we must not book the wrong boat.
  const summary = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (!summary.includes(pick.depart)) {
    return { ok: false, reason: `summary does not mention ${pick.depart}; grid shifted, not booking` };
  }
  const fee = /No Show Fee[\s\S]{0,200}?\$(\d+\.\d{2})/.exec(summary);
  if (fee) log(`no-show fee on this sailing: $${fee[1]} (only charged if you do not show)`);

  const cap = await flow.captchaBlocking(page);
  if (cap.blocking) {
    log(`captcha demanded (${cap.framesFound} frames) — handing off to a human`);
    await dump(page, `book-2-captcha-${pick.date}`);
    return {
      ok: false,
      handoff: true,
      reason: 'WSF is asking for a captcha on the booking step, which this will not attempt to solve',
    };
  }
  log('no captcha on this step');

  if (DRY_RUN) {
    return { ok: false, reason: 'dry run: stopped before Add to Cart' };
  }

  if (!(await clickByText(page, [/add to cart/i], 'Add to Cart'))) {
    await dump(page, `book-2-nocart-${pick.date}`);
    return { ok: false, reason: 'no Add to Cart control on the page' };
  }
  await dump(page, `book-3-cart-${pick.date}`);

  const cap2 = await flow.captchaBlocking(page);
  if (cap2.blocking) {
    await dump(page, `book-3-captcha-${pick.date}`);
    return { ok: false, handoff: true, reason: 'captcha demanded at the cart step' };
  }

  // Checkout. The account has a card saved, so this should be a matter of
  // confirming rather than entering anything.
  await clickByText(page, [/check ?out/i, /continue/i, /proceed/i], 'checkout');
  await dump(page, `book-4-checkout-${pick.date}`);

  const cap3 = await flow.captchaBlocking(page);
  if (cap3.blocking) {
    await dump(page, `book-4-captcha-${pick.date}`);
    return { ok: false, handoff: true, reason: 'captcha demanded at checkout' };
  }

  await clickByText(page, [/confirm|place .*reservation|complete/i], 'final confirm');
  await page.waitForTimeout(4000);
  await dump(page, `book-5-result-${pick.date}`);

  const after = await page.evaluate(() => document.body.innerText).catch(() => '');
  const conf = /confirmation\s*(?:number|#)?\s*:?\s*([A-Z0-9-]{5,})/i.exec(after);
  if (conf) return { ok: true, confirmation: conf[1] };
  if (/your reservation (is )?(confirmed|complete)/i.test(after)) return { ok: true, confirmation: null };

  return { ok: false, reason: 'checkout finished but no confirmation was visible; check the account' };
}

export { BOOK_URL };
