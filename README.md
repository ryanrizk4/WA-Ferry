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

## The captcha, and what it means

WSF puts Google reCAPTCHA on the booking step. This project **does not attempt
to solve or evade it** — that is their anti-bot control and defeating it is out
of scope on purpose.

So there are two possible outcomes when space appears, and which one you get
depends on something still being verified:

1. **Signed-in sessions skip the captcha.** Then booking completes by itself.
2. **The captcha applies even signed in.** Then the run stops at that point and
   sends an urgent notification naming the exact sailing, with a link, within
   seconds of the space appearing. A human finishes it.

Either way the hard part — noticing space the instant it exists, at 7 a.m. —
is automated. Only the last tap might not be.

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
| `src/lib/notify.js` | Tells you what happened. |

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
