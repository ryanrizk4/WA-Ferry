// Mapping the mobile site.
//
// The previous probe answered the question it was asked and raised a bigger
// one. WSF does not serve phones a narrow version of the desktop site. It
// serves a different site: the controls are named MobileMainContent_* instead
// of MainContent_*, the vehicle-height dropdown is a different control
// altogether, and the page fits a phone screen properly instead of needing to
// be pinched.
//
// So there are two possible routes for a person holding a phone at 5 p.m. on
// Sunday with seconds to act:
//
//   1. the mobile site they will land on by default, or
//   2. "Full Site" / Safari's Request Desktop Website, which is the flow
//      already verified end to end, but at 1040px in a 980px window with
//      13-pixel radio buttons.
//
// Choosing between those requires knowing whether the mobile site actually
// completes a search and offers selectable sailings. This maps it: every
// control, by name, in the order a thumb would hit them.
//
// Read-only. It searches and describes. It selects no sailing and books
// nothing.

import { chromium, devices } from 'playwright';
import { trip } from './config.js';
import { wsfDate } from './lib/search.js';

// Findings are buffered and printed together at the end. Reading these runs
// means tailing the log, and the control dumps are long enough to push the
// actual answer out of reach — which has now happened twice.
const lines = [];
const log = (...a) => { lines.push(a.join(' ')); };
const flush = () => {
  console.log('\n\n' + '#'.repeat(70));
  console.log('# SUMMARY');
  console.log('#'.repeat(70));
  console.log(lines.join('\n'));
};
const rule = (t) => log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);
const j = (x) => JSON.stringify(x, null, 2);

const START =
  'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx';

// The mobile site is WebForms too, so the same rule applies: wait on the
// ASP.NET AJAX postback state, never on network idle. Analytics beacons on
// these pages never go quiet.
async function settle(page, ms = 400) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => {
    const prm = window.Sys?.WebForms?.PageRequestManager;
    return !prm || !prm.getInstance().get_isInAsyncPostBack();
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// Every control on the page, described the way a person would need it
// described: what it is, whether a thumb can hit it, what it offers.
async function controls(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return {
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        top: Math.round(r.top + window.scrollY),
        onScreenHorizontally:
          r.left >= 0 && r.right <= document.documentElement.clientWidth,
      };
    };
    const out = { selects: [], inputs: [], links: [] };
    for (const s of document.querySelectorAll('select')) {
      out.selects.push({
        id: s.id || s.name,
        options: [...s.options].map((o) => `${o.value}=${o.text}`.trim()).slice(0, 12),
        ...vis(s),
      });
    }
    for (const i of document.querySelectorAll('input')) {
      if (i.type === 'hidden') continue;
      out.inputs.push({ id: i.id || i.name, type: i.type, value: i.value, ...vis(i) });
    }
    for (const a of document.querySelectorAll('a')) {
      const t = (a.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) out.links.push({ text: t, id: a.id || undefined, ...vis(a) });
    }
    return out;
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage();

try {
  rule('1. What a phone actually lands on');
  await page.goto(START, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  log(`  url:   ${page.url()}`);
  log(`  title: ${await page.title()}`);

  const before = await controls(page);
  log('\n  -- dropdowns on the search page --');
  for (const sel of before.selects) {
    log(`    ${sel.id}  [${sel.size}]  ${sel.options.length} options`);
  }
  log('\n  -- buttons and text boxes --');
  for (const i of before.inputs.filter((x) => x.type !== 'radio')) {
    log(`    ${i.id}  ${i.type}  [${i.size}]  ${JSON.stringify(i.value).slice(0, 40)}`);
  }

  rule('2. Can the search be driven with a thumb?');
  // Work from what is actually on the page rather than from guessed ids: the
  // mobile control names are only known from the previous probe, and guessing
  // is how the desktop flow wasted a day on the wrong height dropdown.
  const ids = before.selects.map((s) => s.id);
  const pick = (re) => ids.find((i) => re.test(i));
  const fromId = pick(/FromTerm/i);
  const toId = pick(/ToTerm/i);
  const vehId = pick(/Vehicle/i);
  const hgtId = pick(/Height/i);
  const dateId = (before.inputs.find((i) => /date/i.test(i.id || '')) || {}).id;
  log(`  departing: ${fromId}\n  arriving:  ${toId}\n  vehicle:   ${vehId}`
    + `\n  height:    ${hgtId}\n  date box:  ${dateId}`);

  await page.selectOption(`#${fromId}`, String(trip.from.id));
  await settle(page);
  await page.waitForFunction(
    ([id, v]) => {
      const s = document.getElementById(id);
      return s && [...s.options].some((o) => o.value === v);
    },
    [toId, String(trip.to.id)],
    { timeout: 20000 },
  );
  await page.selectOption(`#${toId}`, String(trip.to.id));
  await settle(page);
  log('  route set OK');

  const d = wsfDate(trip.targets[0].date);
  await page.evaluate(([id, v]) => {
    const el = document.getElementById(id);
    el.removeAttribute('readonly');
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [dateId, d]);
  await settle(page);
  log(`  date set to ${d}`);

  // Vehicle length, then the height. The first attempt at this stopped on
  // "Please Select Vehicle Height" because it set the length and assumed the
  // height would follow. It does not: both are required, and on the desktop
  // site choosing "under 22 feet" swaps in a different height dropdown while
  // the one visible beforehand is a decoy. So set the length, then look again
  // at what is on the page, then choose the height from whatever is really
  // there rather than from a remembered id.
  await page.selectOption(`#${vehId}`, '3');
  await settle(page);
  const afterVehicle = await controls(page);
  log('\n  -- dropdowns AFTER choosing "vehicle under 22 feet" --');
  for (const sel of afterVehicle.selects) {
    const interesting = /height/i.test(sel.id);
    log(`    ${sel.id}  [${sel.size}]  `
      + (interesting ? sel.options.join(' | ') : `${sel.options.length} options`));
  }

  // "Up to 7'2\" tall" is the traveller's vehicle. Match on the text so this
  // does not depend on the value being the same as the desktop site's.
  const heightSel = afterVehicle.selects.filter((sel) => /height/i.test(sel.id));
  let chosenHeight = null;
  for (const sel of heightSel) {
    const opt = sel.options.find((o) => /up to 7.?2/i.test(o));
    if (!opt) continue;
    const value = opt.split('=')[0];
    try {
      await page.selectOption(`#${sel.id}`, value);
      await settle(page);
      chosenHeight = `${sel.id} = ${opt}`;
      break;
    } catch (e) {
      log(`    could not set ${sel.id}: ${e.message.split('\n')[0].slice(0, 90)}`);
    }
  }
  log(`  height set: ${chosenHeight ?? 'FAILED - no height dropdown accepted a value'}`);
  const selected = await page.evaluate(() =>
    [...document.querySelectorAll('select')].map(
      (s) => `${s.id}=${s.value}${s.offsetParent === null ? ' (hidden)' : ''}`,
    ));
  log(`  what the page believes is selected: ${selected.join('  ')}`);

  rule('3. Does it return a sailing list, and can a thumb hit the rows?');
  const showBtn = afterVehicle.inputs.find((i) => /show/i.test(i.value || ''))
    || afterVehicle.links.find((l) => /show availability/i.test(l.text));
  log(`  the "Show Availability" control: ${j(showBtn)}`);
  if (showBtn?.id) {
    await page.click(`#${showBtn.id}`);
  } else {
    await page.getByText(/show availability/i).first().click();
  }
  await settle(page, 1500);
  await page.waitForTimeout(2000);

  log(`  url after searching: ${page.url()}`);
  const results = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')].map((t) => ({
      id: t.id || '(no id)',
      rows: t.rows.length,
    }));
    const radios = [...document.querySelectorAll('input[type=radio]')].map((r) => {
      const b = r.getBoundingClientRect();
      return {
        id: r.id,
        disabled: r.disabled,
        size: `${Math.round(b.width)}x${Math.round(b.height)}`,
        onScreenHorizontally:
          b.left >= 0 && b.right <= document.documentElement.clientWidth,
      };
    });
    return {
      tables,
      radios,
      widerThanScreen:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 500),
    };
  });
  log(`  tables with more than 2 rows (a sailing list would be one): `
    + j(results.tables.filter((t) => t.rows > 2)));
  log(`  radios (44px is the thumb-friendly minimum):`);
  for (const r of results.radios) {
    log(`    ${r.id}  [${r.size}]  disabled=${r.disabled}  onScreen=${r.onScreenHorizontally}`);
  }
  if (!results.radios.length) log('    NONE - no sailing list came back');
  log(`  page wider than the screen: ${results.widerThanScreen}`);
  log(`\n  page text:\n  ${results.text}`);

  await page.screenshot({ path: 'out/mobile-results.png', fullPage: true }).catch(() => {});
} catch (e) {
  log(`\nSTOPPED: ${e.message.split('\n')[0]}`);
  log(`  url at the time: ${page.url()}`);
  await page.screenshot({ path: 'out/mobile-failure.png', fullPage: true }).catch(() => {});
  const text = await page.evaluate(
    () => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 900),
  ).catch(() => '(could not read)');
  log(`  page said: ${text}`);
} finally {
  await browser.close();
  flush();
}
