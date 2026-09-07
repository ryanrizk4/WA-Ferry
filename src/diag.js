// Does the reservation flow work on a phone?
//
// The plan just changed: no laptops on the trip, so the booking will be done
// on a phone in a hurry. Everything verified so far was on a desktop viewport.
// The site has a "Mobile Site" link in its markup, which means there may be a
// second, different flow, and finding that out at 5 p.m. on Sunday would be
// too late.
//
// Read-only: searches and reports, selects nothing.

import { chromium, devices } from 'playwright';
import { trip } from './config.js';
import * as flow from './lib/flow.js';
import { prepareSearch, searchDate } from './lib/search.js';

const phone = devices['iPhone 14 Pro'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...phone });
const page = await ctx.newPage();

const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${'='.repeat(68)}\n${t}\n${'='.repeat(68)}`);

try {
  rule(`PHONE VIEWPORT: ${phone.viewport.width}x${phone.viewport.height}, touch=${phone.hasTouch}`);

  rule('1. Can the search form be driven at all on a phone?');
  await prepareSearch(page, trip);
  log('  route and vehicle set OK');

  const res = await searchDate(page, trip.targets[0].date, trip);
  log(`  search ran: ${res.ok ? `${res.rows.length} sailings parsed` : res.reason}`);
  if (res.ok) {
    for (const r of res.rows) log(`    ${r.bookable ? 'OPEN' : 'full'}  ${r.depart}  ${r.spacesText}`);
  }

  rule('2. Is anything important off-screen or unreachable by touch?');
  const layout = await page.evaluate(() => {
    const out = {};
    const check = (name, sel) => {
      const el = document.querySelector(sel);
      if (!el) return void (out[name] = 'ABSENT');
      const r = el.getBoundingClientRect();
      out[name] = {
        visible: r.width > 0 && r.height > 0,
        offRight: Math.round(r.right - document.documentElement.clientWidth),
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      };
    };
    check('grid', '#MainContent_gvschedule');
    check('firstRadio', '#MainContent_gvschedule_rdoTypeSelect_0');
    check('refresh', '#MainContent_linkBtnRefresh');
    check('datebox', '#MainContent_txtDatePicker');
    out.pageWiderThanScreen =
      document.documentElement.scrollWidth > document.documentElement.clientWidth;
    out.scrollWidth = document.documentElement.scrollWidth;
    out.clientWidth = document.documentElement.clientWidth;
    return out;
  });
  log(JSON.stringify(layout, null, 2));

  rule('3. Does the site push phones to a separate mobile version?');
  const mobile = await page.evaluate(() => {
    const l = document.querySelector('#mobileLink');
    return l ? { present: true, text: l.innerText.trim(), href: l.getAttribute('href') } : { present: false };
  });
  log(JSON.stringify(mobile));

  rule('4. Radio buttons: are they big enough to hit with a thumb?');
  const touch = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('#MainContent_gvschedule input[type=radio]')];
    return rs.slice(0, 3).map((r) => {
      const b = r.getBoundingClientRect();
      return { id: r.id, w: Math.round(b.width), h: Math.round(b.height), disabled: r.disabled };
    });
  });
  log(JSON.stringify(touch, null, 2));
  log('\n(Apple and Google both say a touch target wants about 44 points.)');
} catch (e) {
  log(`FAILED: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
}
