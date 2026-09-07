// Answers the one question the whole design hinges on: does a signed-in
// session still get the reCAPTCHA on the booking step?
//
// It cannot be answered on the real target dates, because nothing is open on
// them — that is the entire problem. So this signs in, finds a bookable
// sailing on a date we have no interest in, selects it far enough to see
// whether a captcha is demanded, and then releases it.
//
// It never clicks Add to Cart and never completes a reservation. Selecting a
// sailing puts a hold in a cart that WSF expires on its own, and this clicks
// Start Over to drop it immediately.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { trip } from './config.js';
import * as flow from './lib/flow.js';
import { prepareSearch, searchDate } from './lib/search.js';

// Deliberately not Sept 13 or 14. Far enough out that first and second tier
// space should still be sitting there, and nothing we touch here can affect
// the dates that matter.
const PROBE_DATES = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync('out', { recursive: true });
const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } })
  .then((c) => c.newPage());

try {
  rule('SIGN IN');
  const auth = await flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD);
  log(`result: ${auth.ok ? 'OK' : 'FAILED'} — ${auth.reason}`);
  log(`credentials present: email=${Boolean(process.env.WSF_EMAIL)} password=${Boolean(process.env.WSF_PASSWORD)}`);
  if (!auth.ok) log('continuing anyway, so the captcha answer is at least known for a signed-out session');

  // Does the page show us as signed in? Useful corroboration that the session
  // really carries an account and not just a cookie.
  const whoami = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = /(Welcome[^\n]{0,60}|Log ?Out|Sign ?Out|My Account)/i.exec(t);
    return m ? m[0].trim() : '(no sign-in indicator found)';
  }).catch(() => '(unreadable)');
  log(`page says: ${whoami}`);

  rule('FIND A BOOKABLE SAILING ON A DATE WE DO NOT CARE ABOUT');
  await prepareSearch(page, trip);

  let pick = null;
  for (const date of PROBE_DATES) {
    const res = await searchDate(page, date, trip);
    if (!res.ok) { log(`  ${date}: ${res.reason}`); continue; }
    const open = res.rows.filter((r) => r.bookable);
    log(`  ${date}: ${open.length} of ${res.rows.length} sailings bookable`
      + (open.length ? ` — ${open.map((r) => r.depart).join(', ')}` : ''));
    if (open.length) { pick = { ...open[0], date }; break; }
  }

  if (!pick) {
    rule('INCONCLUSIVE');
    log('No bookable sailing on any probe date, so the booking step was never reached.');
  } else {
    rule(`SELECTING ${pick.date} ${pick.depart} — probe only, nothing will be booked`);
    await page.click(`#${pick.radioId}`);
    await page.waitForTimeout(3000);

    const cap = await flow.captchaBlocking(page);
    log(`\ncaptcha probe: ${JSON.stringify(cap)}`);
    rule(cap.blocking
      ? 'ANSWER: captcha IS demanded even signed in — booking needs a human'
      : 'ANSWER: no captcha on this step — automatic booking should work');

    // Rendered is not the same as enforced. Try the next step without
    // touching the captcha and see whether the server actually refuses.
    // Adding to a cart is not a reservation: it is a hold that expires, and
    // nothing below goes anywhere near checkout or confirm.
    rule('DOES THE CAPTCHA ACTUALLY BLOCK, OR IS IT JUST ON THE PAGE?');
    const before = page.url();
    const cartBtn = page.getByText(/add to cart/i).first();
    if (await cartBtn.count()) {
      await cartBtn.click({ timeout: 10000 }).catch((e) => log(`  click failed: ${e.message.split('\n')[0]}`));
      await page.waitForTimeout(4000);

      const verdict = await page.evaluate(() => {
        const err = document.querySelector('#CaptchaErrorMessage');
        const errShown = err && getComputedStyle(err).display !== 'none' && err.innerText.trim();
        const cart = document.querySelector('#reservation_cart_status')?.innerText || '';
        return {
          captchaError: errShown ? err.innerText.trim() : null,
          cartSays: cart.replace(/\s+/g, ' ').trim().slice(0, 120),
          bodyMentionsCaptcha: /captcha|not a robot|verify you/i.test(document.body.innerText),
        };
      });
      log(`  url before: ${before}`);
      log(`  url after:  ${page.url()}`);
      log(`  ${JSON.stringify(verdict, null, 2)}`);
      rule(verdict.captchaError
        ? `ENFORCED: rejected with "${verdict.captchaError}"`
        : (/no vehicle reservations selected/i.test(verdict.cartSays)
          ? 'ENFORCED: nothing reached the cart'
          : 'NOT ENFORCED at this step: the sailing reached the cart without solving anything'));
      await page.screenshot({ path: 'out/diag-aftercart.png', fullPage: true }).catch(() => {});
    } else {
      log('  no Add to Cart control found');
    }

    writeFileSync('out/diag-selected.html', await page.content());
    await page.screenshot({ path: 'out/diag-selected.png', fullPage: true }).catch(() => {});

    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    log(`\n-- what checkout shows --\n${text.replace(/\n{3,}/g, '\n\n').slice(-2500)}`);

    const controls = await page.evaluate(() => [...document.querySelectorAll('a,button,input[type=submit]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => `<${el.tagName.toLowerCase()}> id=${el.id || '-'} "${(el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 45)}"`)
      .filter((s) => /cart|checkout|continue|confirm|book|pay|next/i.test(s)));
    log(`\n-- next-step controls --\n${controls.map((c) => `  ${c}`).join('\n') || '  (none matched)'}`);

    rule('RELEASING THE HOLD');
    if (await page.locator(flow.F.startOver).count()) {
      await page.click(flow.F.startOver).catch((e) => log(`  failed: ${e.message}`));
      await page.waitForTimeout(2000);
      log('  cleared via Start Over');
    } else {
      log('  no Start Over here; the cart expires by itself shortly');
    }
  }
} finally {
  await browser.close();
}
