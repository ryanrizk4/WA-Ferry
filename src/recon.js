// Recon pass over the WSF vehicle reservation site.
//
// This container has no egress to wsdot.wa.gov, so this script exists to be run
// on a GitHub Actions runner, which does. It walks as far into the
// Orcas Island -> Anacortes reservation flow as it can without credentials and
// reports back everything needed to write the real checker and booker:
// where the flow actually lives, which XHR endpoints carry availability, and
// what the form controls are called.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const ENTRY = process.env.ENTRY_URL
  || 'https://secureapps.wsdot.wa.gov/Ferries/Reservations/Vehicle/default.aspx';
const OUT = 'out';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Endpoints the page's own JavaScript hit, in call order. The prize: whichever
// one returns sailing availability for a future date.
const calls = [];

mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const rule = (title) => log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);

function short(s, n = 1400) {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)} ...[+${s.length - n} chars]` : s;
}

async function dumpState(page, label) {
  rule(`STATE: ${label}`);
  log(`url:   ${page.url()}`);
  log(`title: ${await page.title().catch(() => '?')}`);

  const file = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  writeFileSync(`${OUT}/${file}.html`, await page.content());
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true }).catch(() => {});

  // Every control that could plausibly advance the flow, with the attributes
  // we would need in order to drive it later.
  const controls = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const out = [];
    const sel = 'a,button,input,select,textarea,[role=button],[role=link],[onclick]';
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      const o = {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        cls: (el.getAttribute('class') || '').slice(0, 60),
        text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 70),
        href: (el.getAttribute('href') || '').slice(0, 120),
        aria: el.getAttribute('aria-label') || '',
      };
      if (el.tagName === 'SELECT') {
        o.options = [...el.options].slice(0, 40).map((x) => `${x.value}=${x.text.trim()}`);
      }
      out.push(o);
    }
    return out;
  }).catch((e) => [{ error: String(e) }]);

  log(`-- ${controls.length} visible controls --`);
  for (const c of controls) {
    if (c.error) { log(`  ERROR ${c.error}`); continue; }
    let line = `  <${c.tag}${c.type ? ` type=${c.type}` : ''}>`;
    if (c.id) line += ` id=${c.id}`;
    if (c.name) line += ` name=${c.name}`;
    if (c.aria) line += ` aria="${c.aria}"`;
    if (c.text) line += ` text="${c.text}"`;
    if (c.href) line += ` href=${c.href}`;
    log(line);
    if (c.options) for (const o of c.options) log(`      option ${o}`);
  }

  // Frames matter: ASP.NET apps of this vintage sometimes nest the real form.
  const frames = page.frames().map((f) => f.url()).filter((u) => u && u !== page.url());
  if (frames.length) log(`-- frames --\n${frames.map((f) => `  ${f}`).join('\n')}`);

  const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  log(`-- visible text --\n${short(body, 2500)}`);
}

// Click the first control matching any of the given patterns. Returns what it
// clicked, or null when nothing matched, so the caller can stop cleanly.
async function tryClick(page, patterns, what) {
  for (const p of patterns) {
    const loc = page.getByRole('link', { name: p }).or(page.getByRole('button', { name: p }));
    const n = await loc.count().catch(() => 0);
    if (n > 0) {
      const label = await loc.first().innerText().catch(() => String(p));
      log(`\n>> clicking ${what}: "${label.trim()}" (pattern ${p})`);
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
        loc.first().click({ timeout: 10000 }).catch((e) => log(`   click failed: ${e.message}`)),
      ]);
      await page.waitForTimeout(2500);
      return label;
    }
  }
  log(`\n>> no control matched for ${what}: ${patterns}`);
  return null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

page.on('request', (r) => {
  if (['xhr', 'fetch'].includes(r.resourceType())) {
    calls.push({ method: r.method(), url: r.url(), post: short(r.postData(), 600) });
  }
});
page.on('response', async (r) => {
  const ct = r.headers()['content-type'] || '';
  if (!/json|xml/.test(ct)) return;
  const hit = calls.find((c) => c.url === r.url() && !c.status);
  const body = await r.text().catch(() => '<unreadable>');
  const rec = hit || { method: 'GET', url: r.url() };
  rec.status = r.status();
  rec.ct = ct.split(';')[0];
  rec.body = short(body, 2000);
  if (!hit) calls.push(rec);
});
page.on('console', (m) => { if (m.type() === 'error') log(`[browser console error] ${short(m.text(), 200)}`); });

rule('ENTRY');
log(`requesting ${ENTRY}`);
try {
  const resp = await page.goto(ENTRY, { waitUntil: 'networkidle', timeout: 60000 });
  log(`http ${resp?.status()} -> ${page.url()}`);
} catch (e) {
  log(`NAVIGATION FAILED: ${e.message}`);
}
await dumpState(page, '01-landing');

// Step into the reservation flow. Patterns are deliberately loose because we
// have not seen this UI yet.
if (await tryClick(page, [/make a reservation/i, /new reservation/i, /reserve/i, /get started/i, /continue/i], 'start of flow')) {
  await dumpState(page, '02-after-start');
}

// Try to name the route. If the terminals are <select>s we can set them
// directly; if they are cards or links, the click patterns should catch them.
const selects = await page.locator('select').count().catch(() => 0);
if (selects > 0) {
  log(`\n>> ${selects} select elements present; attempting to set Orcas -> Anacortes`);
  for (const [i, want] of [[0, /orcas/i], [1, /anacortes/i]]) {
    const s = page.locator('select').nth(i);
    const opts = await s.locator('option').allTextContents().catch(() => []);
    const match = opts.find((t) => want.test(t));
    if (match) {
      await s.selectOption({ label: match }).catch((e) => log(`   selectOption failed: ${e.message}`));
      log(`   select[${i}] set to "${match}"`);
      await page.waitForTimeout(2000);
    } else {
      log(`   select[${i}] has no option matching ${want}; options: ${opts.slice(0, 25).join(' | ')}`);
    }
  }
  await dumpState(page, '03-route-selected');
} else {
  if (await tryClick(page, [/orcas/i], 'departing terminal Orcas')) {
    await tryClick(page, [/anacortes/i], 'arriving terminal Anacortes');
    await dumpState(page, '03-route-selected');
  }
}

await tryClick(page, [/continue/i, /next/i, /search/i, /find sailings/i, /view sailings/i], 'advance to sailings');
await dumpState(page, '04-sailings');

rule('XHR / JSON CALLS OBSERVED (in order)');
if (!calls.length) log('none — the flow is likely full-postback ASP.NET, not XHR-driven');
for (const [i, c] of calls.entries()) {
  log(`\n[${i}] ${c.method} ${c.url}`);
  if (c.status) log(`    status ${c.status} ${c.ct || ''}`);
  if (c.post) log(`    request body: ${c.post}`);
  if (c.body) log(`    response body: ${c.body}`);
}

writeFileSync(`${OUT}/calls.json`, JSON.stringify(calls, null, 2));

rule('DONE');
await browser.close();
