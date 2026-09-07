# WA-Ferry

Gets a Washington State Ferries vehicle reservation for the ride home:
**Orcas Island to Anacortes**, Sunday Sept 13 or Monday Sept 14, 2026,
car under 22 feet.

## Why this exists

WSF does not put all reservation space on sale at once. On the
Anacortes/San Juan Islands route it comes out in three waves, and their last
one is what we are aiming at:

| Wave | When | What |
|---|---|---|
| First | Two months before the season, 10 a.m. PT | 30% of standard vehicle space |
| Second | Two weeks before the sailing date, 7 a.m. PT | another 30% |
| Third | **Two days before the sailing date, 7 a.m. PT** | the last 30% |

The final 10% is held back for stand-by and no-shows. The first two waves for
these dates have passed. The two-day waves are:

- **Friday Sept 11, 7:00 a.m. PT** for sailings on Sunday Sept 13
- **Saturday Sept 12, 7:00 a.m. PT** for sailings on Monday Sept 14

Space also reappears at random when other people cancel.

## What it does

Everything runs on GitHub Actions, so nothing has to stay open on a laptop.

- **`snipe`** starts well before each wave, because Actions cron is queued and
  drifts. It idles, signs in and primes the search form two minutes out, then
  waits for the exact second and re-checks every couple of seconds.
- **`watch`** polls at a gentle interval the rest of the time, for cancellations.
- **`check`** is a read-only report of what is open. Safe to run anytime.

## The captcha: settled, and it decides the design

WSF puts Google reCAPTCHA on the booking step, and it is **enforced on the
server, not just drawn on the page**. Tested directly: signed in as the account
holder, selecting a sailing and pressing Add to Cart comes back with

> Verification Failed. You need to pass recaptcha challenge to Continue.

and the cart stays empty. Signing in does not skip it.

This project **does not attempt to solve or evade that**. It is WSF's anti-bot
control and defeating it is out of scope on purpose.

So booking cannot be automated, and the design is built around that:

- The bot does the part humans are bad at: watching continuously and being
  awake at 7:00:00 a.m. to the second.
- The instant it sees space, it sends the alert **before** trying anything
  else, because the attempt is known to fail and the seconds belong to you.
- You tick the captcha box and check out.

A phone push is therefore not optional in practice. Email is too slow for a
window measured in seconds.

## If the schedule does not fire

GitHub's cron had not produced a single run of the 15-minute watch in the
45 minutes after it was armed, across three slots, while every push-triggered
run worked immediately. Schedules are known to be delayed or dropped under
load, and this project comes down to two moments that do not come round again.

So there are three independent ways the snipe can start:

1. **Two cron entries**, 06:25 and 06:35 PT on Sept 11 and 12.
2. **A file touch.** Committing any change to `.snipe-trigger` starts a snipe
   run. The script waits out the remaining time itself, so firing any time in
   the half hour before a release is enough.
3. **A scheduled wake-up** on the Claude session that built this, set for
   13:15 UTC on Sept 11 and 12, which checks whether cron already fired and
   touches the trigger file if not.

Either of the first two is sufficient on its own.

The cancellation watch has the same problem and the same answer: an hourly
Claude routine touches `.watch-trigger`, which runs one pass over all three
target windows. That is hourly rather than every fifteen minutes, so it is
thinner cover than intended, but it is cover. If GitHub's cron ever starts
working the two simply run alongside each other, and the booking guard stops
anything being taken twice.

## Setup

Repository secrets, under Settings → Secrets and variables → Actions:

| Secret | Needed for |
|---|---|
| `WSF_EMAIL` | Signing in to the WSF reservations account |
| `WSF_PASSWORD` | Same |
| `NTFY_TOPIC` | Optional. A phone push via ntfy.sh, which is the only channel fast enough to matter if a human has to finish the booking. Pick an unguessable topic name and subscribe to it in the ntfy app. |

The account needs a saved payment method. Reservations are free, but WSF holds
a card against the no-show fee (about $16 on these sailings, charged only if
you do not turn up or cancel late).

## Files

| File | What it is |
|---|---|
| `src/config.js` | The trip, dates, release times, rate limits. The only file to edit if plans change. |
| `src/check.js` | Read-only "what is open right now". |
| `src/book.js` | The run: wait for the release, find space, take it. |
| `src/lib/flow.js` | Drives the reservation site's form. |
| `src/lib/search.js` | Reads the sailing table. |
| `src/lib/booking.js` | Selects a sailing and checks out. Stops at any captcha. |
| `src/lib/time.js` | Pacific time. Getting this wrong by an hour means missing the wave. |
| `src/lib/notify.js` | Tells you what happened. Titles are forced to ASCII; see below. |
| `src/lib/state.js` | Stands the whole thing down once a reservation exists. |

## Notes on the site

Things learned the hard way, recorded so they are not relearned:

- The date box has `maxlength="8"` and wants **M/D/YY**. A four-digit year is
  truncated and then rejected as invalid.
- Height for a vehicle under 22 feet is `ddlCarTruck14To22`, not `dlTempHeight`.
- Every control starts its postback inside `setTimeout(..., 0)`, so "is a
  postback running" is false immediately after a click. Wait for an outcome.
- Never wait on `networkidle`; analytics beacons keep the page busy forever.
- A sailing is bookable when its row's radio is **not disabled**. "More Info..."
  is WSF's wording for sold out with more space coming.
- After a search, "Show Availability" becomes "Refresh", which re-runs the same
  query in one postback.
- **Notification titles must be plain ASCII.** ntfy takes the title as an HTTP
  header, headers carry bytes rather than text, and one em dash threw
  `Cannot convert argument to a ByteString` before the request was sent. No
  push went out, and nothing in the logs looked wrong. Titles are now
  transliterated, with a plain-title retry behind that.
