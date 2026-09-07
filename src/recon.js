// Recon round two: drive the real Orcas Island -> Anacortes flow all the way to
// the sailing list for each date we care about, and dump enough of the result
// to write a parser against.
//
// Runs on a GitHub Actions runner; the authoring container has no route to
// wsdot.wa.gov.

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

// '2026-09-14' -> '09/14/2026', the format the date box expects.
const usDate = (iso) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
const page = await ctx.newPage();

page.on('console', (m) => { if (m.type() === 'error') log(`[console] ${m.text().slice(0, 200)}`); });

for (const target of trip.targets) {
  rule(`TARGET: ${target.label} — ${target.date} (${target.earliest}-${target.latest})`);

  try {
    log(`landed on ${await flow.openSearch(page)}`);

    await flow.setRoute(page, String(trip.from.id), String(trip.to.id));
    log(`route set: ${trip.from.name} (${trip.from.id}) -> ${trip.to.name} (${trip.to.id})`);

    const dateShown = await flow.setDate(page, usDate(target.date));
    log(`date box now reads: "${dateShown}" (wanted ${usDate(target.date)})`);

    await flow.setVehicle(page, flow.VALUES.vehicleUnder22, flow.VALUES.heightUpTo72);
    log('vehicle set: under 22 feet, up to 7\'2" tall');

    await flow.showAvailability(page);
    log(`after Show Availability -> ${page.url()}`);
  } catch (e) {
    log(`FLOW ERROR: ${e.message}`);
  }

  const slug = `avail-${target.date}`;
  writeFileSync(`${OUT}/${slug}.html`, await page.content());
  await page.screenshot({ path: `${OUT}/${slug}.png`, fullPage: true }).catch(() => {});

  const cap = await flow.detectCaptcha(page).catch((e) => ({ error: String(e) }));
  log(`\n-- captcha probe --\n${JSON.stringify(cap, null, 2)}`);

  // The whole visible page, which is where the sailing list and its
  // availability wording live.
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  log(`\n-- visible text --\n${text.replace(/\n{3,}/g, '\n\n').slice(0, 6000)}`);

  // Raw markup of the sailing region, so the parser can be written against
  // real class names instead of guesses.
  const html = await page.evaluate(() => {
    const pick = ['#MainContent_pnlSailings', '#MainContent_updSailings', '#MainContent_divSailings',
      '[id*="Sailing" i]', '#MainContent_pnlAvailability', 'form'];
    for (const s of pick) {
      const el = document.querySelector(s);
      if (el && el.innerHTML.length > 400) return { sel: s, html: el.innerHTML };
    }
    return { sel: 'body', html: document.body.innerHTML };
  }).catch((e) => ({ sel: 'error', html: String(e) }));

  const cleaned = html.html
    .replace(/<script[\s\S]*?<\/script>/gi, '<!--script-->')
    .replace(/<style[\s\S]*?<\/style>/gi, '<!--style-->')
    .replace(/ (value|id|name)="(__VIEWSTATE|__EVENTVALIDATION)[^"]*"/gi, ' $1="<viewstate>"')
    .replace(/value="[A-Za-z0-9+/=%]{200,}"/g, 'value="<long-blob>"')
    .replace(/\s{2,}/g, ' ');
  log(`\n-- sailing markup (from ${html.sel}, ${cleaned.length} chars) --\n${cleaned.slice(0, 14000)}`);

  // Any control that could be a per-sailing "reserve this one" affordance.
  const clickables = await page.evaluate(() => [...document.querySelectorAll('a,button,input[type=submit],input[type=radio]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      name: el.getAttribute('name') || '',
      text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }))
    .filter((c) => /sail|reserv|select|book|depart|\d{1,2}:\d{2}/i.test(`${c.id} ${c.name} ${c.text}`)))
    .catch(() => []);
  log(`\n-- sailing-ish controls (${clickables.length}) --`);
  for (const c of clickables) log(`  <${c.tag}> id=${c.id} name=${c.name} text="${c.text}"`);
}

rule('DONE');
await browser.close();
