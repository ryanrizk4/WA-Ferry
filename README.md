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

## The route that needs no reservation at all

From WSF's own page, verbatim:

> There are no reservations for vehicles going from Shaw Island or Lopez
> Island (eastbound) to Anacortes. Vehicles from these terminals are loaded
> on a first-come, first-served basis.

Orcas is not on that list, which is why getting off Orcas is a lottery. But
Lopez and Shaw are, and interisland sailings inside the San Juans do not take
vehicle reservations either. So there is a path that skips the whole 7 a.m.
scramble:

**Orcas to Lopez or Shaw on an interisland sailing, then Lopez or Shaw to
Anacortes first-come, first-served.**

No release to win, no captcha, no bot. It becomes a queueing problem instead
of a lottery: turn up early and wait in the lane.

The catch is real and worth stating plainly. The Anacortes-bound boat calls at
the islands in sequence and arrives at Lopez already carrying reserved
vehicles from Orcas and Friday Harbor, so the space left can be thin, and a
bad day means waiting for the next sailing. But it is a fallback that does not
depend on beating anyone to a button, and it is worth knowing about before
Sunday rather than after.

Check the interisland schedule for the day, since the connection has to work.

## What it does

Everything runs on GitHub Actions. Nothing has to stay open on a laptop, which
matters because there will not be a laptop on this trip: the phone is the only
device, and the cloud watcher is the whole system rather than a backstop.

- **`watch`** is the main event. It holds a browser open and re-checks every
  45 seconds for hours at a stretch, then hands off to the next run before it
  exits. Space returned by a cancellation can vanish within minutes, so
  the only way to catch one is to be looking when it happens.
- **`snipe`** starts well before each release wave and each cancellation
  deadline, idles, signs in and primes the search form two minutes out, then
  waits for the exact second and re-checks every couple of seconds.
- **`check`** is a read-only report of what is open. Safe to run anytime.

### Why the watch chains itself

GitHub's cron cannot be relied on here. Over one fourteen-hour stretch an
every-fifteen-minutes schedule produced 36 runs where it promised about 120,
and the gaps are exactly when a returned cancellation goes to somebody else.

So the watch does not wait to be scheduled. Each run asks GitHub to start the
next one before it exits, and the cron becomes a safety net rather than the
mechanism. The hand-off runs even when the run crashed or was killed at its
timeout; the only things that stop the chain are the two real endings, a
reservation in hand or the travel window closing, and the code has to write
`out/stop-watching` to say so. If a hand-off ever fails, the run goes red
**and** pushes an urgent notification, because a broken chain that says
nothing is indistinguishable from a quiet week.

### Public repository, continuous watching

Actions minutes are metered on private repositories and unmetered on public
ones. Holding a browser open for hours is only affordable on the second, so
the code asks GitHub which this repository is and picks its own run length:
five and a half hours when public, the old short tapered windows when private,
and it says which in the log. Flipping visibility therefore cannot quietly
produce either a surprise bill or a silently truncated watch.

**While the repository is private, cover is a few minutes out of every
quarter hour rather than continuous.** Settings → General → Danger Zone →
Change visibility is the switch. There are no credentials in the code; they
live in encrypted Actions secrets, which stay private either way.

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

GitHub's cron is unreliable here, so nothing depends on a single trigger.

The watch covers itself by chaining, as above. The snipe runs, which have to
land at an exact minute and do not come round again, have three independent
starts:

1. **Two cron entries** per target, ten minutes apart.
2. **A file touch.** Committing any change to `.snipe-trigger` starts a snipe
   run. The script waits out the remaining time itself, so firing any time in
   the half hour before a release is enough.
3. **A scheduled wake-up** on the Claude session that built this, which checks
   whether cron already fired and touches the trigger file if not.

Any one of them is sufficient on its own.

## Booking from a phone

There is no laptop on this trip, so the booking will be done by hand on a
phone, against a clock, possibly in the middle of the night. `src/local.js`
still exists and still works if a laptop is ever available, but it is not the
plan.

WSF does not serve phones a narrow version of its desktop site. It serves a
**different site**: the controls are named `MobileMainContent_*` rather than
`MainContent_*`, the vehicle-height dropdown is a different control, and the
page fits a phone screen properly instead of needing to be pinched. The
desktop flow is still reachable from a phone through the "Full Site" link at
the bottom of the page, or Safari's Request Desktop Website, but it renders
1040 pixels of content into a 980 pixel window with 13-pixel radio buttons.

`docs/PHONE.md` is the playbook: which of the two to use, and the exact
sequence of taps, worked out in advance so none of it is being figured out
while the space disappears.

One thing to know before the alert arrives: **the sailing page cannot be
deep-linked.** Every query-parameter shape was tried and ignored. Tapping the
notification opens the search form, not a filled-in list of sailings, so the
route, date and vehicle have to be entered by hand every time. That is most of
the elapsed seconds, and it is why the playbook exists.

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
- **The page cannot be deep-linked.** Every query-parameter shape was ignored:
  the terminals come back as -1 and no grid renders. There is no URL that
  lands someone on a filled-in sailing list, which is why the run warns a
  human early enough to set the form up by hand before the release.
- **The cancellation rules, verified from WSF's FAQ.** Change or cancel before
  **5:00 p.m. PT the day before travel** or pay a no-show fee. One final change
  is allowed after that, free, but cancelling after it still incurs the fee.
  **Nothing can be changed or cancelled inside two hours of the sailing.**
  Multiple reservations are allowed but an unused one earns a no-show fee.
  Together these say exactly when space comes back: a cluster at the 5 p.m.
  deadline, a trickle afterwards from people making their one free change, and
  a hard stop two hours before each sailing.
- **Notification titles must be plain ASCII.** ntfy takes the title as an HTTP
  header, headers carry bytes rather than text, and one em dash threw
  `Cannot convert argument to a ByteString` before the request was sent. No
  push went out, and nothing in the logs looked wrong. Titles are now
  transliterated, with a plain-title retry behind that.
