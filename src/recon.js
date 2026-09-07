// Recon round four: what does the booking flow actually ask for?
//
// The search works now, so this does two things:
//   1. reports current availability for both target dates
//   2. selects one bookable sailing to reveal the checkout steps
//
// It deliberately stops at the first checkout screen. Nothing here completes a
// reservation. Selecting a sailing puts it in a cart that WSF expires on its
// own, and the run clicks Start Over at the end to let it go immediately.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { trip } from './config.js';
import * as flow from './lib/flow.js';
import { prepareSearch, searchDate } from './lib/search.js';

const OUT = 'out';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
const page = await ctx.newPage();

await prepareSearch(page, trip);

let bookable = null;
for (const target of trip.targets) {
  rule(`AVAILABILITY: ${target.date} — ${target.label}`);
  const res = await searchDate(page, target.date, trip);
  if (!res.ok) { log(`  ${res.reason}`); continue; }
  log(`  ${res.heading}`);
  for (const r of res.rows) {
    const mark = r.bookable ? 'OPEN  ' : 'full  ';
    log(`  ${mark} ${r.depart.padEnd(9)} ${r.vessel.padEnd(10)} ${r.spacesText}`);
    if (r.bookable && !bookable) bookable = { ...r, date: target.date };
  }

  // Which of the form controls survive a search? This decides whether a
  // repeat check can reuse the page or has to rebuild it, which matters a lot
  // when polling every couple of seconds during a release.
  const census = await page.evaluate(() => Object.fromEntries(
    [['showAvailability', '#MainContent_linkBtnContinue'], ['date', '#MainContent_txtDatePicker'],
      ['fromTerm', '#MainContent_dlFromTermList'], ['vehicle', '#MainContent_dlVehicle'],
      ['height', '#MainContent_ddlCarTruck14To22'], ['startOver', '#MainContent_linkBtnStartOver'],
      ['grid', '#MainContent_gvschedule']]
      .map(([k, sel]) => [k, Boolean(document.querySelector(sel))]),
  ));
  log(`  controls after search: ${JSON.stringify(census)}`);
}

if (!bookable) {
  rule('NO BOOKABLE SAILING RIGHT NOW');
  log('Nothing is open on either date, so the checkout flow cannot be explored');
  log('this run. Re-run when something frees up, or at the 7 a.m. release.');
} else {
  rule(`SELECTING ${bookable.date} ${bookable.depart} to reveal the checkout flow`);
  log('(this only puts a sailing in the cart; nothing is confirmed)');

  // The results table is rebuilt on each search, so re-run the date we want
  // before clicking into it.
  await searchDate(page, bookable.date, trip);
  await page.click(`#${bookable.radioId}`);
  await page.waitForTimeout(3000);

  log(`after selecting -> ${page.url()}`);
  writeFileSync(`${OUT}/selected.html`, await page.content());
  await page.screenshot({ path: `${OUT}/selected.png`, fullPage: true }).catch(() => {});

  const cap = await flow.detectCaptcha(page).catch((e) => ({ error: String(e) }));
  log(`\n-- captcha probe --\n${JSON.stringify(cap)}`);

  const text = await page.evaluate(() => document.body?.innerText || '');
  log(`\n-- visible text --\n${text.replace(/\n{3,}/g, '\n\n').slice(0, 5000)}`);

  // What can we press next, and what does it want from us?
  const controls = await page.evaluate(() => [...document.querySelectorAll('a,button,input,select')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      id: el.id || '',
      name: el.getAttribute('name') || '',
      text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      required: el.hasAttribute('required'),
    })));
  log(`\n-- controls on the checkout screen (${controls.length}) --`);
  for (const c of controls) {
    log(`  <${c.tag}${c.type ? ` type=${c.type}` : ''}> id=${c.id} name=${c.name}`
      + `${c.required ? ' REQUIRED' : ''} text="${c.text}"`);
  }

  // Release the cart rather than leaving a sailing held for someone else.
  rule('RELEASING THE CART');
  const startOver = await page.locator(flow.F.startOver).count();
  if (startOver) {
    await page.click(flow.F.startOver).catch((e) => log(`  start over failed: ${e.message}`));
    await page.waitForTimeout(2000);
    log(`  clicked Start Over -> ${page.url()}`);
  } else {
    log('  no Start Over control on this screen; the cart will expire on its own');
  }
}

rule('DONE');
await browser.close();
