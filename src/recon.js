// Recon round three.
//
// Round two got the route in but stalled on two things: the date box has
// maxlength=8 so a four-digit year never fit, and the height dropdown for a
// car under 22 feet is a different control than the one being set. Height is
// fixed in flow.js; the date format is still a guess, so probe candidates here
// and let the page's own validation say which one it accepts.
//
// Then run the search and dump the sailing table, which is the thing the
// checker actually has to read.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { trip } from './config.js';
import * as flow from './lib/flow.js';

const OUT = 'out';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

// Candidates, shortest first. maxlength=8 makes MM/DD/YY the favourite.
const dateFormats = {
  'MM/DD/YY': ([y, m, d]) => `${m}/${d}/${y.slice(2)}`,
  'M/D/YY': ([y, m, d]) => `${+m}/${+d}/${y.slice(2)}`,
  'MM/DD/YYYY': ([y, m, d]) => `${m}/${d}/${y}`,
  'MMDDYYYY': ([y, m, d]) => `${m}${d}${y}`,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') log(`[console] ${m.text().slice(0, 160)}`); });

const target = trip.targets[0];
const iso = target.date.split('-');

rule(`DATE FORMAT PROBE for ${target.date}`);
let winner = null;
for (const [name, fmt] of Object.entries(dateFormats)) {
  const candidate = fmt(iso);
  try {
    await flow.openSearch(page);
    await flow.setRoute(page, String(trip.from.id), String(trip.to.id));
    const shown = await flow.setDate(page, candidate);
    const v = await flow.readValidation(page);
    const rejected = Boolean(v.cvTravelDate);
    log(`  ${name.padEnd(11)} sent "${candidate}" -> box reads "${shown}" ${rejected ? `REJECTED: ${v.cvTravelDate}` : 'ACCEPTED'}`);
    if (!rejected && shown) { winner = candidate; break; }
  } catch (e) {
    log(`  ${name.padEnd(11)} sent "${candidate}" -> error: ${e.message.split('\n')[0]}`);
  }
}
log(`\nwinning format: ${winner ?? 'NONE — every candidate was rejected'}`);

if (winner) {
  rule(`SEARCH: ${trip.from.name} -> ${trip.to.name} on ${target.date}`);
  try {
    await flow.setVehicle(page, flow.VALUES.vehicleUnder22, flow.VALUES.heightUpTo72);
    log('vehicle set: under 22 feet, up to 7\'2" tall');
    log(`validation before search: ${JSON.stringify(await flow.readValidation(page))}`);

    await flow.showAvailability(page);
    log(`search done -> ${page.url()}`);
    log(`validation after search: ${JSON.stringify(await flow.readValidation(page))}`);
  } catch (e) {
    log(`SEARCH ERROR: ${e.message.split('\n')[0]}`);
  }

  writeFileSync(`${OUT}/search.html`, await page.content());
  await page.screenshot({ path: `${OUT}/search.png`, fullPage: true }).catch(() => {});

  const cap = await flow.detectCaptcha(page).catch((e) => ({ error: String(e) }));
  log(`\n-- captcha probe --\n${JSON.stringify(cap)}`);

  // The sailing table. This is what the checker parses, so dump it raw.
  const sched = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? { found: true, text: el.innerText, html: el.innerHTML } : { found: false };
  }, flow.F.schedule).catch((e) => ({ found: false, error: String(e) }));

  if (!sched.found) {
    log(`\n!! ${flow.F.schedule} not found ${sched.error ?? ''}`);
  } else {
    log(`\n-- #schedule visible text --\n${sched.text.slice(0, 4000)}`);
    const clean = sched.html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\s{2,}/g, ' ');
    log(`\n-- #schedule markup (${clean.length} chars) --\n${clean.slice(0, 12000)}`);
  }

  // Whatever the per-sailing affordance turns out to be.
  const picks = await page.evaluate(() => [...document.querySelectorAll('#schedule a,#schedule button,#schedule input')]
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      cls: (el.getAttribute('class') || '').slice(0, 50),
      onclick: (el.getAttribute('onclick') || el.getAttribute('href') || '').slice(0, 120),
      text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    }))).catch(() => []);
  log(`\n-- clickable things inside #schedule (${picks.length}) --`);
  for (const p of picks.slice(0, 60)) log(`  <${p.tag}> id=${p.id} cls=${p.cls} text="${p.text}" -> ${p.onclick}`);
}

rule('DONE');
await browser.close();
