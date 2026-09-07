// Verify the claim that 5 p.m. the day before travel is the penalty-free
// cancellation deadline, and that WSF tells people to check for space then.
//
// This came from an outside review, not from the site, so it gets checked
// before any of the plan is rebuilt around it. If it holds, the two most
// valuable minutes of this whole week are 5 p.m. Saturday and 5 p.m. Sunday,
// not 7 a.m.

import { chromium } from 'playwright';

const PAGES = [
  'https://wsdot.wa.gov/travel/washington-state-ferries/ferry-reservations',
  'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/Default.aspx',
  'https://wsdot.wa.gov/ferries/tickets/ticket-information',
  'https://wsdot.wa.gov/travel/washington-state-ferries/vehicle-reservations-faq',
];

// A sentence only counts as support if it ties a clock time to cancelling.
const ABOUT_CANCELLING = /(cancel|no.?show|change your reservation|check back|becomes available)/i;
const HAS_CLOCK = /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/i;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA }).then((c) => c.newPage());

let supported = 0;
try {
  for (const url of PAGES) {
    console.log(`\n${'='.repeat(70)}\n${url}\n${'='.repeat(70)}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!resp?.ok()) { console.log(`  http ${resp?.status()}`); continue; }
      await page.waitForTimeout(1200);

      await page.evaluate(() => {
        for (const d of document.querySelectorAll('details')) d.open = true;
        for (const el of document.querySelectorAll('[aria-expanded="false"], summary, .accordion-button')) {
          try { el.click(); } catch { /* ignore */ }
        }
      }).catch(() => {});
      await page.waitForTimeout(1800);

      const text = await page.evaluate(() => document.body?.innerText || '');
      const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/\s+/g, ' ').trim());
      const hits = sentences.filter((x) => x.length > 20 && ABOUT_CANCELLING.test(x));

      if (!hits.length) { console.log('  nothing about cancelling here'); continue; }
      for (const h of hits.slice(0, 30)) {
        const key = HAS_CLOCK.test(h);
        if (key) supported += 1;
        console.log(`  ${key ? '>>> ' : '    '}${h.slice(0, 320)}`);
      }
    } catch (e) {
      console.log(`  failed: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(70)}`);
console.log(supported
  ? `VERDICT: ${supported} sentence(s) tie a clock time to cancelling. Read the >>> lines above.`
  : 'VERDICT: found nothing tying a clock time to cancelling. The 5 p.m. claim is NOT confirmed here.');
