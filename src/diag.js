// When exactly does the cancellation window close?
//
// WSF charges a no-show fee "if you do not use your reservation or if you
// cancel after the allowed cancellation window". That window has a deadline,
// and deadlines create spikes: people who are not going to travel cancel just
// before it, to dodge the fee. If we know when it falls, we know the single
// best minute in the week to be watching, and it is not 7 a.m.
//
// Read-only. Fetches published pages and prints the relevant wording.

import { chromium } from 'playwright';

const PAGES = [
  'https://wsdot.wa.gov/travel/washington-state-ferries/vehicle-reservations',
  'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/Default.aspx',
  'https://wsdot.wa.gov/ferries/tickets/refunds',
  'https://secureapps.wsdot.wa.gov/Ferries/Reservations/vehicle/shared/Save_a_Spot_FAQs.pdf',
];

// Sentences that could carry the deadline.
const PATTERN = /(cancel|no.?show|change your reservation|refund)/i;
const DEADLINE = /(\d{1,2}\s*(a\.?m\.?|p\.?m\.?)|\d+\s*(hours?|days?|minutes?)|day before|night before|prior to)/i;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA }).then((c) => c.newPage());

try {
  for (const url of PAGES) {
    console.log(`\n${'='.repeat(70)}\n${url}\n${'='.repeat(70)}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!resp?.ok()) { console.log(`  http ${resp?.status()}`); continue; }
      await page.waitForTimeout(1500);

      const text = await page.evaluate(() => document.body?.innerText || '');
      const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/\s+/g, ' ').trim());

      const hits = sentences.filter((x) => x.length > 25 && PATTERN.test(x));
      if (!hits.length) { console.log('  nothing about cancelling on this page'); continue; }

      for (const h of hits.slice(0, 25)) {
        console.log(`  ${DEADLINE.test(h) ? '>> ' : '   '}${h.slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`  failed: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
}
