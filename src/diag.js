// Get the exact wording around the cancellation advice.
//
// The FAQ does say to check "the day before your preferred reservation, which
// is when people can cancel without a no-show fee". The clock time sits in the
// first half of that sentence, which sentence-splitting cut off. So stop
// splitting and print the raw neighbourhood of the phrase.

import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const ANCHORS = [
  'day before your preferred reservation',
  'without a no-show fee',
  'Check back frequently',
  'cancellation',
];

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA }).then((c) => c.newPage());

try {
  await page.goto('https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/Default.aspx',
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);

  const q = page.getByText(/How do I change or cancel a vehicle reservation/i).first();
  if (await q.count()) {
    await q.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  // Open everything else too, in case the advice lives under another question.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
    for (const el of document.querySelectorAll('a,button,summary,[role=button]')) {
      const t = (el.innerText || '').toLowerCase();
      if (t.includes('?') || t.includes('cancel') || t.includes('change')) {
        try { el.click(); } catch { /* ignore */ }
      }
    }
  }).catch(() => {});
  await page.waitForTimeout(2500);

  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  for (const anchor of ANCHORS) {
    console.log(`\n${'='.repeat(70)}\nANCHOR: "${anchor}"\n${'='.repeat(70)}`);
    let from = 0;
    let found = 0;
    for (;;) {
      const i = text.indexOf(anchor, from);
      if (i === -1) break;
      found += 1;
      console.log(`\n  ...${text.slice(Math.max(0, i - 400), i + 300)}...`);
      from = i + anchor.length;
      if (found >= 3) break;
    }
    if (!found) console.log('  not present');
  }
} finally {
  await browser.close();
}
