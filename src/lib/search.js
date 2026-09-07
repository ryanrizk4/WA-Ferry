// Reading the sailing table.
//
// The results grid is an ASP.NET GridView, one row per sailing:
//
//   [radio] [depart time] [reservation status] [ada] [vessel] [hidden category]
//
// The radio in the first column is the honest signal. It is rendered
// disabled when a sailing has no reservable space and enabled when it does,
// which is more reliable than matching the status text ("Space Available" vs
// "More Info...", where "More Info..." is WSF's phrasing for sold out with
// more space coming at the next release).

import { inWindow } from './time.js';
import * as flow from './flow.js';

// The date box has maxlength=8 and accepts M/D/YY. A four-digit year is
// silently truncated and then rejected as invalid.
export function wsfDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${+m}/${+d}/${y.slice(2)}`;
}

// Load the search page and set everything that does not change between
// polls. Doing this once and then only re-setting the date keeps each
// subsequent check to a single postback.
export async function prepareSearch(page, trip) {
  await flow.openSearch(page);
  await flow.setRoute(page, String(trip.from.id), String(trip.to.id));
  await flow.setVehicle(page, flow.VALUES.vehicleUnder22, flow.VALUES.heightUpTo72);
}

export async function parseSailings(page) {
  return page.evaluate(() => {
    const table = document.querySelector('#MainContent_gvschedule');
    if (!table) return { ok: false, reason: 'no sailing table on the page', rows: [] };

    const header = document.querySelector('#MainContent_panelheader');
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const radio = tr.querySelector('input[type=radio]');
      const tds = tr.querySelectorAll('td');
      if (!radio || tds.length < 3) continue; // header row

      const status = tr.querySelector('label.Status');
      rows.push({
        radioId: radio.id,
        // A disabled radio means there is nothing to reserve on this sailing.
        bookable: !radio.disabled,
        depart: (tds[1]?.innerText || '').trim(),
        spacesText: (status?.innerText || '').replace(/\s+/g, ' ').trim(),
        vessel: (tr.querySelector('a#VesselLink')?.innerText || '').trim(),
        category: (tds[5]?.innerText || '').trim(),
      });
    }
    return { ok: true, heading: (header?.innerText || '').replace(/\s+/g, ' ').trim(), rows };
  });
}

// "7:05 AM" -> "07:05", so it can be compared against a target window.
function to24h(t) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export async function searchDate(page, isoDate, trip) {
  // Running a search consumes the form: the page swaps in results and the
  // Show Availability button goes away. Before each search, make sure we are
  // looking at a form we can actually drive, and rebuild it if not.
  const hasContinue = (await page.locator(flow.F.showAvailability).count()) > 0;
  const hasRefresh = (await page.locator(flow.F.refresh).count()) > 0;
  if (!hasContinue && !hasRefresh) {
    if (!trip) throw new Error('search form is gone and no trip given to rebuild it');
    await prepareSearch(page, trip);
  }

  await flow.setDate(page, wsfDate(isoDate));
  const bad = await flow.readValidation(page);
  if (bad.cvTravelDate) throw new Error(`date rejected: ${bad.cvTravelDate}`);

  // After the first search the button becomes Refresh; both re-run the query.
  if (await page.locator(flow.F.showAvailability).count()) await flow.showAvailability(page);
  else await flow.refreshAvailability(page);

  return parseSailings(page);
}

// Walk the targets in preference order and return every sailing that is both
// bookable and inside its window, best first. The caller takes rows[0].
export async function findAvailability(page, trip) {
  if (!(await page.locator(flow.F.fromTerm).count())) await prepareSearch(page, trip);

  const matches = [];
  for (const target of trip.targets) {
    const res = await searchDate(page, target.date, trip);
    if (!res.ok) {
      console.log(`  ${target.date}: ${res.reason}`);
      continue;
    }
    const summary = res.rows
      .map((r) => `${r.depart}${r.bookable ? '=OPEN' : ''}`)
      .join(', ');
    console.log(`  ${target.date} (${target.label}): ${res.rows.length} sailings — ${summary}`);

    for (const r of res.rows) {
      const hhmm = to24h(r.depart);
      if (!hhmm || !r.bookable) continue;
      if (!inWindow(hhmm, target.earliest, target.latest)) continue;
      matches.push({ ...r, date: target.date, label: target.label, hhmm });
    }
  }
  // trip.targets is already in preference order and we appended in that order,
  // so an earlier match outranks a later one; within a date, earlier sails first.
  return matches;
}
