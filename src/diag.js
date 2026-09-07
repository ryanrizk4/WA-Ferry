// Does the reservation flow work on a phone?
//
// The plan changed: no laptops on the trip, so the booking happens on a phone
// under time pressure. The first phone probe failed immediately — the
// departing-terminal dropdown never appeared — but it failed by throwing, so
// it did not say why. That distinction decides the whole plan:
//
//   - if the SCREEN SIZE is the problem, the page is there but awkward, and
//     we practise the taps;
//   - if the USER AGENT is the problem, WSF is serving phones something else,
//     and "Request Desktop Website" is the workaround to rehearse;
//   - if neither works, the phone cannot do this at all and we need another
//     answer entirely.
//
// So: three scenarios, each reporting rather than throwing.
//
// Read-only. Searches and describes; selects nothing, books nothing.

import { chromium, devices } from 'playwright';
import { trip } from './config.js';
import { prepareSearch, searchDate } from './lib/search.js';

const log = (...a) => console.log(...a);
const rule = (t) => log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

const iphone = devices['iPhone 14 Pro'];
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SCENARIOS = [
  {
    key: 'phone',
    title: 'A. Real phone: iPhone screen AND iPhone Safari user agent',
    why: 'what happens if the traveller just opens the site on their phone',
    ctx: { ...iphone },
  },
  {
    key: 'desktop-mode',
    title: 'B. Phone screen, desktop user agent ("Request Desktop Website")',
    why: 'the one-tap workaround in Safari, if the user agent is the problem',
    ctx: { ...iphone, userAgent: DESKTOP_UA },
  },
  {
    key: 'laptop',
    title: 'C. Control: full desktop window',
    why: 'proves the probe itself works and the site is up',
    ctx: { userAgent: DESKTOP_UA, viewport: { width: 1440, height: 1200 } },
  },
];

// What is actually on the page right now, whatever it turned out to be.
async function describe(page) {
  return page.evaluate(() => {
    const el = (sel) => document.querySelector(sel);
    const box = (sel) => {
      const e = el(sel);
      if (!e) return 'ABSENT';
      const r = e.getBoundingClientRect();
      return {
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        offRightBy: Math.round(r.right - document.documentElement.clientWidth),
        onScreen: r.width > 0 && r.height > 0,
      };
    };
    return {
      url: location.href,
      title: document.title,
      fromTerminalDropdown: box('#MainContent_dlFromTermList'),
      dateBox: box('#MainContent_txtDatePicker'),
      grid: box('#MainContent_gvschedule'),
      selectsOnPage: [...document.querySelectorAll('select')].map((s) => s.id || s.name),
      buttonsOnPage: [...document.querySelectorAll('a,button,input[type=submit]')]
        .map((b) => (b.innerText || b.value || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 25),
      widerThanScreen:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      firstText: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 400),
    };
  }).catch((e) => ({ error: e.message }));
}

const browser = await chromium.launch();

for (const s of SCENARIOS) {
  rule(`${s.title}\n   (${s.why})`);
  const ctx = await browser.newContext(s.ctx);
  const page = await ctx.newPage();
  const t0 = Date.now();

  try {
    await prepareSearch(page, trip);
    log('  form driven OK: route and vehicle set');
  } catch (e) {
    log(`  COULD NOT DRIVE THE FORM: ${e.message.split('\n')[0]}`);
  }

  const state = await describe(page);
  log(`  landed on: ${state.url}`);
  log(`  page title: ${state.title}`);
  log(`  departing-terminal dropdown: ${JSON.stringify(state.fromTerminalDropdown)}`);
  log(`  date box: ${JSON.stringify(state.dateBox)}`);
  log(`  selects present: ${JSON.stringify(state.selectsOnPage)}`);
  log(`  page wider than screen: ${state.widerThanScreen} `
    + `(${state.scrollWidth}px content in a ${state.clientWidth}px window)`);
  log(`  buttons: ${JSON.stringify(state.buttonsOnPage)}`);
  log(`  text begins: ${state.firstText}`);

  // Only worth searching if the form was reachable at all.
  if (state.fromTerminalDropdown !== 'ABSENT') {
    try {
      const res = await searchDate(page, trip.targets[0].date, trip);
      log(`  search ran: ${res.ok ? `${res.rows.length} sailings parsed` : res.reason}`);
      if (res.ok) {
        for (const r of res.rows) {
          log(`    ${r.bookable ? 'OPEN' : 'full'}  ${r.depart}  ${r.spacesText}`);
        }
        const touch = await page.evaluate(() => {
          const rs = [...document.querySelectorAll('#MainContent_gvschedule input[type=radio]')];
          return rs.slice(0, 3).map((r) => {
            const b = r.getBoundingClientRect();
            return {
              id: r.id,
              size: `${Math.round(b.width)}x${Math.round(b.height)}`,
              onScreenHorizontally:
                b.right <= document.documentElement.clientWidth && b.left >= 0,
              disabled: r.disabled,
            };
          });
        });
        log(`  radio buttons (44px is the thumb-friendly minimum): ${JSON.stringify(touch)}`);
      }
    } catch (e) {
      log(`  SEARCH FAILED: ${e.message.split('\n')[0]}`);
    }
  }

  await page.screenshot({ path: `out/${s.key}.png`, fullPage: true }).catch(() => {});
  log(`  (${Math.round((Date.now() - t0) / 1000)}s, screenshot saved as ${s.key}.png)`);
  await ctx.close();
}

await browser.close();
