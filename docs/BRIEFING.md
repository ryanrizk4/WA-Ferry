# WA Ferry reservation problem — full briefing for a second opinion

Self-contained. You do not need any other context. Everything factual below was
verified against the live site unless explicitly marked as an assumption.

Date of writing: Sunday 7 September 2026.

---

## 1. The goal

Get **one Washington State Ferries vehicle reservation, Orcas Island →
Anacortes**, for a car under 22 feet (under 7'2" tall).

Acceptable sailings, in strict preference order:

1. **Monday 14 Sept, 05:00–11:00** (preferred)
2. **Sunday 13 Sept, 16:00–23:59** (fallback — lodging is booked for Sunday night, so this is second choice)
3. **Monday 14 Sept, 11:01–23:59** (last resort — bad for the itinerary, but
   getting off the island at all beats not getting off)

### Why the timing is rigid

After landing at Anacortes they drive to Coupeville, take the
Coupeville→Port Townsend ferry (**already reserved**, not a problem), and
continue to the Olympic peninsula. They need essentially the whole of Monday
for that chain to work. A midday or evening Monday departure from Orcas breaks
it, hence it being a last resort rather than a real option.

### Current state

**Both preferred windows are completely sold out.** All 7 sailings on both
Sunday 13th and Monday 14th show "More Info..." (WSF's wording for sold out).
One sailing (Mon 9:25 PM) was briefly open and was taken within ~6 minutes,
observed directly.

### Constraint the user has already ruled out

Lopez and Shaw Islands have **no vehicle reservations eastbound to Anacortes**
(first-come, first-served, per WSF). So Orcas→Lopez interisland then
Lopez→Anacortes standby sidesteps the whole lottery. **The user has rejected
this** — the itinerary is too tight to absorb the risk of not getting on.

---

## 2. How WSF releases reservation space (verbatim from their site)

Anacortes/San Juan Islands route, three phases:

- **Two months before the season starts, 10 a.m. PT** — 30% of standard vehicle
  spaces released. A "virtual waiting room" guards this one.
- **Two weeks before each sailing date, 7 a.m. PT** — another 30%.
- **Two days before each sailing date, 7 a.m. PT** — the last 30%.
- The final 10% is held for emergency and stand-by.

The first two waves for these dates have passed. The remaining opportunities:

| Wave | Fires | For sailings on |
|---|---|---|
| Two-day | **Fri 11 Sept, 07:00:00 PT** | Sunday 13 Sept |
| Two-day | **Sat 12 Sept, 07:00:00 PT** | Monday 14 Sept |

Plus cancellations, which appear at random and vanish in minutes.

A previous release was attempted manually, on the site at the exact moment,
and it sold out immediately. That is the core problem to beat.

---

## 3. The blocker: a server-enforced captcha

The reservation site is `secureapps.wsdot.wa.gov/ferries/reservations/vehicle/`
(classic ASP.NET WebForms).

Where the captcha sits in the flow:

| Step | Captcha? |
|---|---|
| Load page, set route Orcas→Anacortes | No |
| Set date, vehicle length, vehicle height | No |
| Press "Show Availability" → full sailing list, including which are bookable | **No** |
| Click the radio for a specific sailing | reCAPTCHA widget renders |
| Press "Add to Cart" | **Server rejects without it** |

Tested signed-out and signed-in as the account holder. Identical both times.
Pressing Add to Cart without solving returns, verbatim:

> Verification Failed.You need to pass recaptcha challenge to Continue.

and the cart stays empty ("No vehicle reservations selected"). So it is enforced
server-side, not merely rendered. Signing in grants no exemption.

**Position taken by Claude (the assistant that built this):** it declined to
build a captcha bypass — solver service, fingerprint/stealth evasion, or hunting
for an unprotected endpoint — on the grounds that the captcha is the operator's
queue-fairness control and defeating it takes a scarce spot from other travellers
queuing honestly. The user has pushed back on this twice. **If you disagree,
say so plainly and explain your reasoning; we want to hear it.** But note
the factual finding stands regardless: it is server-enforced, so nothing short of
actually defeating it will book automatically.

Consequence: the bot can do everything up to and including *detecting* space
within ~1 second. A human must do the final ~3 clicks.

---

## 4. Hard-won technical facts about the site

Recorded so you do not have to rediscover them:

- Entry point is `SailingSchedule.aspx`. `default.aspx` is a marketing/login
  page; the search form is one click deeper.
- Date field `#MainContent_txtDatePicker` has `maxlength="8"` and accepts
  **M/D/YY** (e.g. `9/14/26`). A four-digit year is truncated then rejected as
  invalid.
- Vehicle height for "under 22 feet" is `#MainContent_ddlCarTruck14To22`
  (value `1000` = up to 7'2"). NOT `dlTempHeight`, which also exists.
- Terminal IDs: Orcas Island `15`, Anacortes `1`. Vehicle length `3` = under 22ft.
- Every control fires its postback from inside `setTimeout(..., 0)`, so
  immediately after a click nothing is in flight and "is a postback running"
  returns false. Must wait for an actual outcome (the grid, or a validation
  message), not for quiet.
- **Never** wait on `networkidle` — analytics beacons keep the page busy forever.
  This alone cost ~100 seconds per search before being caught.
- A sailing is bookable when its row's radio is **not disabled**. "More Info..."
  is the sold-out wording, with a tooltip explaining more space comes later.
- After a search, "Show Availability" is replaced by a "Refresh" button that
  re-runs the same query in a single postback. This is the cheap re-poll path.
- The page **cannot be deep-linked**. Every query-parameter shape tried was
  ignored (terminals come back `-1`, no grid). So there is no URL that drops a
  human onto a pre-filled form — they must set it up by hand.
- No-show fee is ~$16 per sailing, charged only if you do not travel or cancel
  late. A card must be on file. Reservations themselves are free.
- WSF says the fee applies if you "cancel after the allowed cancellation window"
  — **the deadline for that window has not been found yet.** See open questions.

---

## 5. What has been built

Node + Playwright, running on GitHub Actions, repo `the traveller/WA-Ferry`.

| Piece | What it does | Status |
|---|---|---|
| `src/check.js` | Read-only "what is open right now" | Verified |
| `src/book.js` | The watcher/sniper. Signs in, searches, alerts | Verified |
| `src/local.js` | Same thing on a local machine, visible browser, stops at the captcha | **Never run** |
| `src/lib/flow.js` | Drives the ASP.NET form | Verified |
| `src/lib/search.js` | Parses the sailing grid | Verified |
| `src/lib/notify.js` | ntfy phone push + GitHub issue | Verified |

**Release sniping:** starts ~40 min early (Actions cron is queued and drifts),
idles, signs in and primes the form 7 minutes out, pushes the user a "get set up
now" alert with the exact settings, pushes again at 60 seconds, then at
07:00:00 polls every 1s for the first minute, 3s thereafter, and keeps a slower
watch out to **35 minutes past** the hour to catch space returning when other
people's carts expire unpaid. Rehearsed end to end against a fake release time.

**Cancellation watching:** each triggered run polls for a stretch that grows as
the trip approaches (5 min now, 15 min inside 2 days, 40 min on the final day),
checking every 45 seconds.

**Alerting:** ntfy push to the traveller's phone, verified delivering.

---

## 6. Infrastructure problems encountered (important context)

1. **GitHub Actions cron is very unreliable on this repo.** A `*/15 * * * *`
   schedule produced **two runs in ten hours**. Not delayed — dropped. A second
   offset schedule was added as a hedge, plus a routine that fires every 2 hours
   from a Claude session that holds the repo and pushes a trigger commit.
2. **Actions minutes are capped**: 2,000/month on a private repo, and hitting
   the cap silently stops everything (default spending limit is $0). This is the
   binding constraint on how continuously the cloud watcher can run. The user's
   own laptop is free and unmetered, which is why `local.js` matters.
3. Three bugs were found, each of which had silently made the tool useless while
   appearing healthy:
   - Notification titles are sent as an HTTP header; a single em dash threw
     `Cannot convert argument to a ByteString` and **no push was ever sent**.
   - The watch loop's duration was never wired in — a failed string replacement
     that wrote the file anyway. **Every watch run was a single check** lasting
     seconds, for a full night.
   - No recovery from a stuck page; one timeout would silently kill the rest of
     a run while still reporting success.

---

## 7. Where a second opinion is wanted

Be blunt. Confident wrong answers have already cost us once here.

1. **Is there a legitimate angle being missed?** Standby mechanics, phoning WSF
   (206-464-6400), a different route or terminal combination, travelling as a
   walk-on and solving the car separately, anything.
2. **The cancellation-window deadline.** WSF charges a no-show fee if you cancel
   after some cutoff. Deadlines create spikes — people who are not travelling
   cancel just before them. Finding that exact cutoff would identify the single
   best minute in the week to be watching, likely far better odds than 07:00:00
   when everyone is looking. What is that deadline for the Anacortes/San Juan
   route?
3. **Do you agree with the captcha position?** If you would approach it
   differently, say why.
4. **Is the strategy right?** The claim being made is that cancellations are a
   better bet than the release, because at 07:00:00 you compete with everyone,
   whereas a random Tuesday cancellation has almost no competition. Is that
   sound?
5. **Anything structurally smarter** than "poll and alert a human"?

## 8. What the human's job currently is

At 07:00:00 on Fri 11 and Sat 12 Sept: be holding the phone, have the sailing
list already open with route/date/vehicle set (the bot warns 7 minutes and
60 seconds ahead), press Refresh on the hour, click the sailing the bot names,
tick the captcha, press Add to Cart. Realistically 8 seconds of work if
pre-positioned, versus ~40 if starting cold.
