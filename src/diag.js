// Second attempt at the cancellation deadline.
//
// The generic accordion-opening did not reveal the answer. The question "How
// do I change or cancel a vehicle reservation?" is definitely on the VRS home
// page, so click that exact element and read whatever appears, rather than
// hoping a blanket expand-everything works.

import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA }).then((c) => c.newPage());

const report = (label, text) => {
  console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);
  const wanted = /(cancel|no.?show|change).{0,400}/gis;
  const clock = /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/i;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/\s+/g, ' ').trim());
  const hits = sentences.filter((x) => x.length > 20 && wanted.test(x));
  if (!hits.length) return console.log('  nothing relevant');
  for (const h of hits.slice(0, 40)) console.log(`  ${clock.test(h) ? '>>> ' : '    '}${h.slice(0, 340)}`);
};

try {
  // 1. The VRS home page FAQ, clicked by its exact question text.
  await page.goto('https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/Default.aspx',
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);

  const q = page.getByText(/How do I change or cancel a vehicle reservation/i).first();
  if (await q.count()) {
    await q.click({ timeout: 8000 }).catch((e) => console.log(`click failed: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(2500);
    console.log(`after clicking the FAQ question -> ${page.url()}`);
  } else {
    console.log('FAQ question not found on the page');
  }
  report('VRS home page after opening the cancel FAQ', await page.evaluate(() => document.body.innerText));

  // 2. The reservations info page the VRS site itself links to.
  for (const url of [
    'https://www.wsdot.wa.gov/ferries/reservations',
    'https://wsdot.wa.gov/travel/washington-state-ferries/reservations',
  ]) {
    try {
      const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!r?.ok()) { console.log(`\n${url} -> http ${r?.status()}`); continue; }
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('details')) d.open = true;
        for (const el of document.querySelectorAll('button,summary,[role=button],a[data-toggle]')) {
          const t = (el.innerText || '').toLowerCase();
          if (t.includes('cancel') || t.includes('change') || t.includes('faq')) {
            try { el.click(); } catch { /* ignore */ }
          }
        }
      }).catch(() => {});
      await page.waitForTimeout(2000);
      report(`${url}  (final: ${page.url()})`, await page.evaluate(() => document.body.innerText));
    } catch (e) {
      console.log(`\n${url} -> ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
}
