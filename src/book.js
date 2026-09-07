// The thing that actually runs.
//
// Two modes:
//
//   snipe  Started ~20 minutes before a known release by the scheduled
//          workflow, because Actions cron is queued and drifts. It waits out
//          the remaining time locally, so the first request lands within a
//          second or two of 7:00:00 a.m. Pacific rather than whenever the
//          runner happened to boot. Then it sprints for a short window.
//
//   watch  A single pass, for catching cancellations between releases.
//
// In both modes, finding space and booking it are the same code path. The only
// difference is how hard and how long it looks.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { trip, releases, limits, stopAfter } from './config.js';
import { nowPT, msUntil, humanDuration } from './lib/time.js';
import { alreadyBooked } from './lib/state.js';
import { notify, callOffRepeats, resumeRepeats } from './lib/notify.js';

const MODE = process.env.MODE === 'snipe' ? 'snipe' : 'watch';
const DRY_RUN = process.env.DRY_RUN === 'true';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

mkdirSync('out', { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Overridable so a rehearsal does not have to sit through the full 35 minutes.
const sprintWindowMs = () => Number(process.env.TEST_SPRINT_MS) || limits.sprintWindowMs;

// The release we are here for: the next one still ahead of us, or one that
// fired within the sprint window (a late-starting runner must not give up).
function currentRelease() {
  // A dress rehearsal can name its own release time. The 7 a.m. path only
  // executes twice for real, on days that do not come round again, so it
  // needs to have been run at least once before then.
  const fake = process.env.TEST_RELEASE_AT;
  if (fake) {
    log(`REHEARSAL: treating ${fake} PT as the release`);
    return { at: fake, wave: 'dress rehearsal (not a real release)', ms: msUntil(fake) };
  }
  const candidates = releases
    .map((r) => ({ ...r, ms: msUntil(r.at) }))
    .filter((r) => r.ms > -limits.sprintWindowMs && r.ms < 60 * 60_000)
    .sort((a, b) => a.ms - b.ms);
  return candidates[0] ?? null;
}

// One retry, because the failure that matters happens two minutes before a
// release and a transient hiccup there costs the whole run.
// Unlimited Actions minutes are the whole reason continuous watching is
// possible, and they only come with a public repository. Ask GitHub rather
// than assume: running continuously on a private repo would burn a 2,000
// minute allowance in under two days and then stop everything, snipers
// included, exactly when it matters most.
async function actionsAreFree() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return false;
    const j = await r.json();
    return j.visibility === 'public' || j.private === false;
  } catch {
    return false;
  }
}

// Held at module scope so the top-level handler can close it even when the
// failure happens before the main loop's own cleanup is in scope. Playwright
// keeps the event loop alive, so an unclosed browser turns a crash into a hang
// that runs until the job times out.
let browser = null;

async function withRetry(fn, what, attempts = 2) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      log(`${what}: attempt ${i} of ${attempts} failed — ${e.message.split('\n')[0]}`);
      if (i < attempts) await sleep(2000);
    }
  }
  throw last;
}

// Telling the workflow whether to start another run after this one.
//
// The watch is supposed to be continuous, and it cannot rely on GitHub's cron
// to make that happen: over one fourteen-hour stretch the schedule produced
// 36 runs where it promised about 120. So each run arranges its own successor
// instead, and this file is the brake. Absent, the workflow starts another
// run; present, it stops for good.
//
// The default is deliberately "keep going". A crash, a hung browser, a killed
// process — none of them write this file, so none of them can quietly end the
// watch. Only the two real endings do: the reservation is made, or the boat
// has sailed.
// How hard to poll right now, in watch mode.
//
// Most of the time 45 seconds is plenty and is polite to a public agency's
// servers. But the hours before each 5 p.m. cancellation deadline are where
// the space actually comes from, and being three times as likely to be
// looking at the right moment is the single cheapest improvement available
// now that minutes are unmetered. See hotWindows in config.js for why those
// particular hours.
function watchPollMs() {
  const hot = (limits.hotWindows ?? []).find(
    (w) => msUntil(w.from) <= 0 && msUntil(w.to) > 0,
  );
  if (!hot) return limits.idlePollMs;
  if (watchPollMs.said !== hot.why) {
    watchPollMs.said = hot.why;
    log(`in a high-value window (${hot.why}): checking every `
      + `${humanDuration(limits.hotPollMs)} instead of ${humanDuration(limits.idlePollMs)}`);
  }
  return limits.hotPollMs;
}

function standDown(why) {
  try {
    mkdirSync('out', { recursive: true });
    writeFileSync('out/stop-watching', `${why}\n`);
    log(`wrote out/stop-watching (${why}); no further runs will be started`);
  } catch (e) {
    log(`could not write the stop marker: ${e.message}`);
  }
}

async function main() {
  log(`mode=${MODE} dryRun=${DRY_RUN} nowPT=${nowPT()}`);

  if (msUntil(stopAfter) < 0) {
    log(`travel window closed at ${stopAfter} PT; nothing left to do.`);
    standDown('the travel window has closed');
    return;
  }

  // A reservation already in hand means stop. Booking a second one just earns
  // a no-show fee on whichever goes unused.
  const prior = await alreadyBooked();
  if (prior.booked) {
    log(`already booked — "${prior.title}" (${prior.url}). Standing down.`);
    standDown(`already booked: ${prior.title}`);
    return;
  }
  if (!prior.known) log(`could not confirm whether we already booked: ${prior.reason}`);

  const channels = [
    process.env.NTFY_TOPIC ? 'phone push (ntfy)' : null,
    process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY ? 'GitHub issue' : null,
  ].filter(Boolean);
  log(`alert channels: ${channels.join(' + ') || 'NONE — an alert would go nowhere'}`);
  if (!process.env.NTFY_TOPIC) {
    log('  no NTFY_TOPIC set. Since WSF blocks automated booking behind a captcha,');
    log('  a phone push is the only channel fast enough to be worth anything here.');
  }

  log(`route: ${trip.from.name} -> ${trip.to.name}, car under 22 feet`);
  for (const t of trip.targets) log(`  target: ${t.label} ${t.date} ${t.earliest}-${t.latest}`);

  let deadline = Date.now(); // when to stop looking
  let release = null;
  if (MODE === 'snipe') {
    release = currentRelease();
    if (!release) {
      log('no release is due within the hour; nothing to snipe. Exiting cleanly.');
      return;
    }
    log(`release: ${release.wave} at ${release.at} PT (${humanDuration(release.ms)} away)`);

    // Sit idle, then warm up with enough margin to also get a human ready.
    // Seven minutes covers signing in, priming the form, and sending a
    // heads-up in time for someone to actually open the page and set it up.
    const WARMUP_LEAD = 7 * 60_000;
    const idle = release.ms - WARMUP_LEAD;
    if (idle > 0) {
      log(`idling ${humanDuration(idle)}, then warming up ${humanDuration(WARMUP_LEAD)} early`);
      await sleep(idle);
    }
    deadline = Date.now() + sprintWindowMs();
  }

  // In watch mode, keep looking for a stretch rather than glancing once.
  // Without this the loop breaks on its first pass, which is exactly what it
  // did for a full night: every run was a single check covering a few seconds
  // out of the hour, and the watchWindows config was never read at all.
  if (MODE === 'watch') {
    const free = await actionsAreFree();
    let runFor;
    if (free) {
      // Public repo: minutes are free, so hold the line for almost the whole
      // six hour job limit and let the chain start the next one. That is
      // continuous cover, which is what this needs now that there is no
      // laptop to fall back on.
      runFor = limits.continuousRunMs;
      log(`repository is public, so Actions minutes are unmetered: watching `
        + `continuously for ${humanDuration(runFor)}, checking every `
        + `${humanDuration(limits.idlePollMs)}`);
    } else {
      const soonest = Math.min(...trip.targets.map((t) => msUntil(`${t.date}T00:00:00`)));
      const hours = soonest / 3_600_000;
      const w = limits.watchWindows.find((x) => hours <= x.withinHours);
      runFor = w?.runForMs ?? 0;
      log(`repository is PRIVATE, so minutes are capped. ${hours.toFixed(1)}h until `
        + `the first travel date, so watching for ${humanDuration(runFor)} this run, `
        + `checking every ${humanDuration(limits.idlePollMs)}`);
      log('  make the repository public to get continuous watching instead');
    }
    deadline = Date.now() + runFor;
  }

  browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  const { findAvailability, prepareSearch } = await import('./lib/search.js');
  const { bookSailing } = await import('./lib/booking.js');
  const flow = await import('./lib/flow.js');

  // Sign in first. The account has a payment method saved, so an authenticated
  // session skips the slowest part of checkout. A failed login is not fatal
  // here — better to keep looking and report honestly than to bail — but it
  // does mean booking will not complete, so say so loudly.
  const auth = await withRetry(
    () => flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD),
    'sign in',
  ).catch((e) => ({ ok: false, reason: `sign-in threw: ${e.message.split('\n')[0]}` }));
  log(`login: ${auth.ok ? 'OK' : 'FAILED'} — ${auth.reason}`);
  // Deliberately not notifying here. The watch runs every fifteen minutes and
  // usually finds nothing, so a broken login would otherwise fire an alert on
  // every run for days. It only matters at the moment there is something to
  // take, so it is folded into the message sent then.

  // Load the search form and set everything that does not change, so the
  // moment the release lands we are one postback away from an answer.
  await withRetry(() => prepareSearch(page, trip), 'prime the search form');
  log('search form primed: route and vehicle set');

  if (release) {
    // The slow part of booking is not reacting, it is setting up: opening the
    // site, choosing the route, typing the date, picking the vehicle. Done
    // beforehand, the whole job at 7:00:00 is Refresh, click the sailing,
    // tick the box. So tell the human to get into position now.
    await notify({
      title: `Ferry ${release.kind === 'cancellation' ? 'cancellation window' : 'release'} in `
        + `${Math.round(msUntil(release.at) / 60000)} minutes - get set up now`,
      body: `${release.wave}, at ${release.at.slice(11, 16)} Pacific.\n\n`
        + (release.kind === 'cancellation'
          ? `This is the penalty-free cancellation cutoff the day before travel. `
            + `People who are not going give their space back around now.\n\n`
          : '')
        + `Open this on your phone or laptop right now and set it up, so at 7:00 `
        + `all you have to do is hit Refresh:\n\n`
        + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx\n\n`
        + `Set: Departing Orcas Island, Arriving Anacortes, date, `
        + `Vehicle under 22 feet, Up to 7'2" tall. Press Show Availability once.\n\n`
        + `Then wait on that page. At 7:00:00 press Refresh, and I will text you `
        + `which sailing opened the instant I see it. Click that one, tick the `
        + `captcha, Add to Cart.`,
      priority: 'high',
      issue: false,
    });

    const remaining = msUntil(release.at);
    if (remaining > 65_000) {
      await sleep(remaining - 60_000);
      await notify({
        title: 'Ferry release in 60 seconds - be on the page',
        body: 'Sixty seconds. Have the sailing list open with the route, date and '
          + 'vehicle already set. Press Refresh right on the hour, and watch for my '
          + 'next message naming the sailing.',
        priority: 'high',
        issue: false,
      });
    }

    const left = msUntil(release.at);
    if (left > 0) {
      log(`primed with ${humanDuration(left)} to go; holding until the release`);
      await sleep(Math.max(0, left - 500));
    }
    deadline = Date.now() + sprintWindowMs();
  }

  let attempts = 0;
  let pass = 0;
  let consecutiveFailures = 0;
  // Which sailing the phone is currently being alarmed about, and when.
  let alertedKey = null;
  let lastAlertMs = 0;
  let firstSeenMs = 0;
  try {
    do {
      pass += 1;
      let found = null;
      try {
        found = await findAvailability(page, trip);
        consecutiveFailures = 0;
      } catch (e) {
        consecutiveFailures += 1;
        log(`pass ${pass}: search failed (${consecutiveFailures} in a row): ${e.message.split('\n')[0]}`);

        // Recover rather than limp. The page can get into a state it will not
        // come out of on its own, and without this every later pass fails the
        // same way while the run still reports success. On a forty minute
        // watch that means one stumble silently kills the rest of it.
        if (consecutiveFailures >= 2) {
          log('  rebuilding: signing in again and re-priming the form');
          try {
            const again = await flow.login(page, process.env.WSF_EMAIL, process.env.WSF_PASSWORD);
            log(`  sign in: ${again.ok ? 'OK' : 'FAILED'} — ${again.reason}`);
            await prepareSearch(page, trip);
            consecutiveFailures = 0;
            log('  recovered');
          } catch (e2) {
            log(`  rebuild failed: ${e2.message.split('\n')[0]}`);
          }
        }
      }

      if (!found?.length) {
        // The space is gone. Call off any repeats still queued so the phone
        // stops buzzing about a chance that has passed, and let the next find
        // start a fresh alarm.
        if (alertedKey) {
          // How long the space actually lasted. This is the number the whole
          // design turns on and it has never been measured: if returned space
          // typically sits for several minutes there is time to book by hand,
          // and if it evaporates in under a minute there mostly is not.
          const heldMs = Date.now() - firstSeenMs;
          log(`SPACE GONE: ${alertedKey} was open for ${humanDuration(heldMs)} `
            + `(first seen ${new Date(firstSeenMs).toISOString()})`);
          callOffRepeats();
          alertedKey = null;
        }
      }

      if (found?.length) {
        // findAvailability returns matches already ordered by our preference,
        // so the first one is the best sailing actually on offer.
        const pick = found[0];

        // Alert again if this is a different sailing, or if the same one is
        // still sitting there a minute later and still unbooked. One alert per
        // opportunity was not enough; one per minute for as long as the
        // opportunity lasts is what this needs to be.
        const key = `${pick.date} ${pick.depart}`;
        const now = Date.now();
        const fresh = key !== alertedKey;
        const stale = now - lastAlertMs > limits.realertGapMs;
        if (!fresh && !stale) {
          log(`pass ${pass}: ${key} still open, ${humanDuration(now - firstSeenMs)} `
            + `since first seen; last alert ${humanDuration(now - lastAlertMs)} ago`);
          if (Date.now() >= deadline) break;
          await sleep(MODE === 'watch' ? watchPollMs() : limits.sprintPollMs);
          continue;
        }
        if (fresh) {
          resumeRepeats();
          firstSeenMs = now;
        }
        alertedKey = key;
        lastAlertMs = now;
        log(`pass ${pass}: SPACE FOUND — ${pick.date} ${pick.depart} (${pick.label}), ${pick.spacesText}`);

        // Alert first, before anything else. WSF enforces a reCAPTCHA on the
        // booking step server-side — it rejects with "You need to pass
        // recaptcha challenge to Continue" and leaves the cart empty — so the
        // booking attempt below is expected to fail and its only value is
        // being wrong about that. The notification is the product, and every
        // second it waits is a second of a window measured in seconds.
        await notify({
          title: `GO NOW: ${pick.depart} on ${pick.date} is open`,
          body: `${pick.spacesText} on the ${pick.depart} sailing (${pick.vessel}), `
            + `${trip.from.name} to ${trip.to.name}, ${pick.date} — ${pick.label}.\n\n`
            + `Book it here, fast:\n`
            + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx\n\n`
            + `Orcas Island -> Anacortes, date ${pick.date}, vehicle under 22 feet, up to 7'2" tall.\n`
            + `Pick ${pick.depart}, tick the "I'm not a robot" box, then Add to Cart and check out.\n\n`
            + `WSF requires that captcha, so this part cannot be automated.`,
          priority: 'high',
          // Re-alerts go to the phone but not to the issue tracker: one issue
          // per opportunity is a record, one a minute is a mess.
          issue: fresh,
        });

        if (DRY_RUN) {
          await notify({
            title: `Dry run: space open on ${pick.date} ${pick.depart}`,
            body: `Found ${pick.spacesText} on the ${pick.depart} sailing, ${trip.from.name} to `
              + `${trip.to.name}, ${pick.date}.\n\nThis was a dry run, so nothing was booked.`,
            priority: 'high',
          });
          return;
        }

        attempts += 1;
        const result = await bookSailing(page, pick, trip);
        if (result.ok) {
          await notify({
            title: `Booked: ${pick.date} ${pick.depart} Orcas to Anacortes`, // 'Booked:' prefix is the standdown marker
            body: `Confirmation: ${result.confirmation ?? 'see the reservation site'}\n\n`
              + `Sailing: ${pick.depart} on ${pick.date} (${pick.label})\n`
              + `Check in at the tollbooth at least 30 minutes before departure, and arrive `
              + `45-60 minutes early. Remember the reservation is not a ticket; buy that at `
              + `the terminal or online.`,
            priority: 'high',
          });
          return;
        }
        // The expected outcome: WSF's captcha refused it. Retrying the booking
        // is pointless, a second attempt fails identically.
        //
        // But this used to end the whole run, and that was wrong. On
        // 7 September the watcher found the 8:50 a.m. Monday sailing, alerted,
        // exited, and the person saw the alert too late. Standing down at the
        // exact moment the space exists is backwards: the chance is live until
        // somebody books it, and every second of it deserves another push.
        // So keep watching, and keep alerting while it is still there.
        if (result.handoff) {
          log(`pass ${pass}: captcha refused it, as expected — ${result.reason}; `
            + `staying on it in case the space holds`);
        }

        // Anything else is a surprise worth a second look, but the human has
        // already been told to go, so keep it quiet and just record it.
        log(`pass ${pass}: booking attempt ${attempts} failed: ${result.reason}`);
        if (!auth.ok) log(`  (sign-in had also failed: ${auth.reason})`);
        if (attempts >= limits.maxBookingAttempts) return;
      } else {
        log(`pass ${pass}: nothing available`);
      }

      if (Date.now() >= deadline) break;
      if (MODE === 'watch') {
        await sleep(watchPollMs());
        continue;
      }

      // Three speeds. Hard through the first minute, eased through the rush,
      // then a slow patient watch for carts expiring unpaid.
      const sinceStart = Date.now() - (deadline - sprintWindowMs());
      let gap = limits.sprintEasedPollMs;
      if (sinceStart < limits.sprintHardMs) gap = limits.sprintPollMs;
      else if (sinceStart > limits.secondWaveAfterMs) gap = limits.secondWavePollMs;
      await sleep(gap);
    } while (Date.now() < deadline);

    log(`finished after ${pass} pass(es); no reservation made`);
    if (MODE === 'snipe') {
      await notify({
        title: 'Release came and went with nothing available',
        body: `Sprinted for ${humanDuration(sprintWindowMs())} after the release and never `
          + `saw space on either target sailing. The cancellation watch keeps running.`,
        priority: 'normal',
      });
    }
  } finally {
    await browser?.close();
    browser = null;
  }
}

// Nothing may fail quietly. A crash during warm-up would otherwise mean the
// release passes with no reservation and no word about why.
try {
  await main();
} catch (e) {
  const detail = e?.stack?.split('\n').slice(0, 4).join('\n') ?? String(e);
  console.error(detail);
  await notify({
    title: 'Ferry bot crashed - check it before the next release',
    body: `The ${MODE} run failed before it could finish.\n\n${detail}\n\n`
      + `Book by hand if a release is imminent: `
      + `https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx`,
    priority: 'high',
  }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
