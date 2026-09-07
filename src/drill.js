// A live fire drill for the alert.
//
// The whole system comes down to one moment: a notification arrives, and
// somebody who is possibly asleep has about a minute to act on it. That
// notification has never been seen with real content in it, because every
// sailing on both target dates has been full the entire time this was built.
// An alert nobody has read before is a poor thing to meet at 3 a.m.
//
// So this finds a date on the real route that genuinely has space, and sends
// the real alert about it, through the same notification code the watcher
// uses, formatted exactly the same way.
//
// It cannot book anything. It does not import the booking code at all, and
// the title says DRILL so a real alert can never be confused with this one.

import { chromium } from 'playwright';
import { trip } from './config.js';
import { prepareSearch, searchDate } from './lib/search.js';
import { notify } from './lib/notify.js';
import { nowPT } from './lib/time.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const log = (...a) => console.log(...a);

// How many days ahead to look for a sailing with space. Reservations open
// well in advance, so the far end of the window is where the empty boats are.
const DAYS_TO_SCAN = Number(process.env.DRILL_DAYS ?? 45);
const START_OFFSET = Number(process.env.DRILL_START ?? 3);

function isoPlusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch();
const page = await browser
  .newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } })
  .then((c) => c.newPage());

try {
  log(`drill starting at ${nowPT()} Pacific`);
  log(`route: ${trip.from.name} -> ${trip.to.name}, car under 22 feet`);
  log(`scanning up to ${DAYS_TO_SCAN} dates from ${START_OFFSET} days out\n`);

  await prepareSearch(page, trip);

  let hit = null;
  for (let i = START_OFFSET; i < START_OFFSET + DAYS_TO_SCAN && !hit; i++) {
    const date = isoPlusDays(i);
    const res = await searchDate(page, date, trip);
    if (!res.ok) {
      log(`  ${date}: ${res.reason}`);
      continue;
    }
    const open = res.rows.filter((r) => r.bookable);
    log(`  ${date}: ${res.rows.length} sailings, ${open.length} with space`);
    if (open.length) hit = { date, row: open[0], open, total: res.rows.length };
  }

  if (!hit) {
    log('\nNo date in the scanned range has space, so there is nothing real to '
      + 'alert about. Widen DRILL_DAYS and try again.');
    await notify({
      title: 'DRILL: could not find any sailing with space',
      body: `Scanned ${DAYS_TO_SCAN} dates on ${trip.from.name} to ${trip.to.name} `
        + `and every sailing was full, so the drill could not show you a real `
        + `availability alert. The notification path itself is working, since `
        + `this message reached you.`,
      priority: 'high',
      issue: false,
    });
  } else {
    const { date, row, open, total } = hit;
    log(`\nusing ${date} ${row.depart} (${row.spacesText}) for the drill`);

    // Word for word what the real alert says, with the drill marking added.
    // The point is to rehearse the real thing, so the only differences are
    // the ones that make it impossible to mistake for the real thing.
    await notify({
      title: `DRILL - not real: ${row.depart} on ${date} is open`,
      body: `THIS IS A TEST. Do not book anything.\n\n`
        + `A real alert looks exactly like this, except the title starts with `
        + `"GO NOW" and the date is Sept 13 or 14.\n\n`
        + `-------------------------------------------\n\n`
        + `${row.spacesText} on the ${row.depart} sailing (${row.vessel}), `
        + `${trip.from.name} to ${trip.to.name}, ${date}.\n\n`
        + `Book it here, fast:\n`
        + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx\n\n`
        + `Orcas Island -> Anacortes, date ${date}, vehicle under 22 feet, up to 7'2" tall.\n`
        + `Pick ${row.depart}, tick the "I'm not a robot" box, then Add to Cart and check out.\n\n`
        + `WSF requires that captcha, so this part cannot be automated.\n\n`
        + `-------------------------------------------\n\n`
        + `${open.length} of ${total} sailings had space on this date. `
        + `Tapping this notification opens the search page. Nothing has been booked.`,
      priority: 'high',
      issue: false,
    });
    log('drill alert sent');
  }
} catch (e) {
  log(`drill failed: ${e.message.split('\n')[0]}`);
  await notify({
    title: 'DRILL failed - the alert path may be broken',
    body: `The drill could not complete: ${e.message.split('\n')[0]}\n\n`
      + `This message itself arriving means notifications work, but the search `
      + `did not, so check the run log.`,
    priority: 'high',
    issue: false,
  });
  process.exitCode = 1;
} finally {
  await browser.close();
}
