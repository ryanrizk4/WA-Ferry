// Can the booking page be deep-linked?
//
// At a release the human's clock starts when the alert lands and stops when
// the captcha is ticked. Most of that is setup: open the site, choose the
// route, type the date, pick the vehicle, then find the sailing. If the page
// accepts any of that as a URL, the alert can carry a link that lands straight
// on the sailing list and cuts the slow part out.
//
// Read-only. Selects nothing, holds nothing.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Shapes worth trying, based on the control names the form actually posts.
const CANDIDATES = [
  `${BASE}?from=15&to=1&date=9/14/26`,
  `${BASE}?departingterm=15&arrivingterm=1&tripdate=9/14/26`,
  `${BASE}?FromTerm=15&ToTerm=1&Date=9/14/26`,
  `${BASE}?dlFromTermList=15&dlToTermList=1&txtDatePicker=9/14/26`,
  `${BASE}?ctl00$MainContent$dlFromTermList=15&ctl00$MainContent$dlToTermList=1`,
];

mkdirSync('out', { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA }).then((c) => c.newPage());

try {
  for (const url of CANDIDATES) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const state = await page.evaluate(() => {
        const v = (sel) => document.querySelector(sel)?.value ?? '(absent)';
        return {
          from: v('#MainContent_dlFromTermList'),
          to: v('#MainContent_dlToTermList'),
          date: v('#MainContent_txtDatePicker'),
          vehicle: v('#MainContent_dlVehicle'),
          gridPresent: Boolean(document.querySelector('#MainContent_gvschedule')),
        };
      });
      const prefilled = state.from === '15' || state.to === '1' || state.date !== '';
      log(`${prefilled ? 'PREFILLED' : 'ignored  '}  ${url.replace(BASE, '...')}`);
      log(`            from=${state.from} to=${state.to} date="${state.date}" grid=${state.gridPresent}`);
    } catch (e) {
      log(`error     ${url.replace(BASE, '...')} -> ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
}
