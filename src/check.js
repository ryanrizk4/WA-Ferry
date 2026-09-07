// Read-only availability report.
//
// Runs the same search path the booker uses, prints what is open on each
// target date, and touches nothing. Safe to run as often as you like, and it
// doubles as the regression test for the search code: if this stops printing
// a sailing table, the booker would have failed at the release too.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { trip, releases } from './config.js';
import { nowPT, msUntil, humanDuration } from './lib/time.js';
import { prepareSearch, searchDate } from './lib/search.js';
import { inWindow } from './lib/time.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync('out', { recursive: true });
const log = (...a) => console.log(...a);

const to24h = (t) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

log(`now: ${nowPT()} Pacific`);
log(`route: ${trip.from.name} -> ${trip.to.name}, car under 22 feet\n`);

for (const r of releases) {
  const ms = msUntil(r.at);
  log(ms > 0
    ? `next release: ${r.wave} — ${r.at} PT, ${humanDuration(ms)} from now`
    : `past release: ${r.wave} — ${r.at} PT, ${humanDuration(ms)}`);
}

const browser = await chromium.launch();
const page = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } })
  .then((c) => c.newPage());

let anyWanted = 0;
try {
  await prepareSearch(page, trip);

  for (const target of trip.targets) {
    const res = await searchDate(page, target.date, trip);
    log(`\n${target.label} — ${target.date}, want ${target.earliest}-${target.latest}`);
    if (!res.ok) { log(`  ${res.reason}`); continue; }

    for (const row of res.rows) {
      const hhmm = to24h(row.depart);
      const wanted = hhmm && inWindow(hhmm, target.earliest, target.latest);
      const flag = row.bookable ? (wanted ? '>> OPEN AND WANTED' : '   open') : '   full';
      log(`  ${flag.padEnd(20)} ${row.depart.padEnd(9)} ${row.vessel.padEnd(9)} ${row.spacesText}`);
      if (row.bookable && wanted) anyWanted += 1;
    }
  }
} finally {
  await browser.close();
}

log(`\n${anyWanted > 0
  ? `${anyWanted} sailing(s) open inside a window we want`
  : 'nothing open inside either window we want'}`);
