# OpenAI additive improvements — Orcas → Anacortes

Date checked: 2026-09-07

## Bottom line

Keep the existing watcher/sniper architecture. The strongest improvement I found is to give it a **dedicated high-attention cancellation mode around 5:00 p.m. PT the day before travel**, because WSF itself identifies that time as a good time to check for newly returned reservation space: 5:00 p.m. is the penalty-free cancellation deadline.

For this trip, the two priority cancellation windows are:

- **Saturday 2026-09-12, roughly 4:40–5:20 p.m. PT** — returned space for Sunday 9/13.
- **Sunday 2026-09-13, roughly 4:40–5:20 p.m. PT** — returned space for Monday 9/14. This is the most important cancellation window for the preferred Monday-morning target.

The published two-day release snipes remain unchanged and critical:

- **Friday 2026-09-11 at 7:00:00 a.m. PT** — Sunday 9/13 inventory.
- **Saturday 2026-09-12 at 7:00:00 a.m. PT** — Monday 9/14 inventory.

## Live-site findings that can improve the strategy

1. Anacortes/San Juan standard-vehicle inventory is released 30% season-opening, 30% two weeks out, 30% two days out, with the final 10% held for emergency/standby.
2. WSF specifically tells customers without the desired reservation to check frequently and calls out **around 5:00 p.m. the day before travel** because customers can cancel before that deadline without a no-show fee.
3. WSF says reservation holders can make one final change after 5:00 p.m. the day before. That means returned space can continue appearing after the main 5 p.m. cancellation cluster as people move between sailings.
4. The current live WSF page says changes/cancellations lock out less than **two hours** before the reserved sailing. An older WSF Terms PDF says three hours for Anacortes/San Juan. Treat the current live two-hour wording as the working rule but avoid making the plan depend on the disputed 2–3 hour interval unless WSF confirms it.
5. If any Monday reservation becomes available, even a late one, it has extra value: WSF says a reservation holder can arrive for an earlier sailing on the same service day and travel standby. It does not provide standby priority, but it gives a guaranteed later escape while allowing attempts at earlier departures.
6. Customer Service is 888-808-7977 or 206-464-6400, 7:00 a.m.–5:30 p.m. PT daily. Their useful role here is clarifying edge-case rules; WSF says agents cannot see hidden reservation inventory unavailable on the website.

## Improvements I would add to the existing system

### 1. Add a dedicated 5 p.m. cancellation sprint

The current general cancellation watcher is useful, but the newly verified 5 p.m. deadline gives us a reason to concentrate polling budget at a specific predictable time rather than treating every minute equally.

Suggested behavior:

- Start the focused window around **4:40 p.m. PT**.
- Keep the existing form/session primed.
- Poll more frequently than the ordinary 45-second cancellation cadence during this short window.
- Continue through roughly **5:20 p.m. PT**, because cancellations submitted immediately before 5 and resulting inventory changes may not all become visible at exactly 5:00:00.
- Keep normal cancellation watching before and after this window.

For the actual trip dates, run that mode on **9/12 for the Sunday fallback** and **9/13 for Monday**.

### 2. Use the local visible-browser watcher as the fastest handoff path at high-value windows

`src/local.js` already has the right architecture: it searches from the user's own laptop, selects the sailing when space appears, and leaves the page at the CAPTCHA so the human finishes.

The useful improvement is not to replace the cloud watcher; it is to make the local watcher an additional high-speed lane during the two release windows and the two 5 p.m. cancellation windows. Cloud remains the unattended backup.

The success path becomes:

1. Space appears.
2. Local watcher identifies the best acceptable sailing.
3. It selects that sailing automatically.
4. Browser is already visible on the user's laptop.
5. User solves CAPTCHA and presses Add to Cart.

That removes notification/open-page/setup latency from the most important moments.

### 3. Add a focused `--window` mode to `local.js`

The existing `--at` mode is excellent for exact release times, but a cancellation deadline is different: space can appear both shortly **before and after** 5 p.m.

A useful new mode is:

`npm run local -- --window "2026-09-13T17:00:00"`

Behavior:

- start active high-frequency watching 20 minutes before the center time;
- continue 20 minutes after;
- retain the existing normal watcher behavior outside that special interval;
- still stop at CAPTCHA exactly as `local.js` already does.

This turns the live-site 5 p.m. finding into working software rather than just a calendar reminder.

### 4. Make the alert path race the browser selection, not block it

When space appears in `local.js`, the most important action is getting the browser onto the sailing immediately. Phone push is valuable if the user stepped away, but network latency to the notification service should not delay selecting the radio button.

Improvement: start the phone notification and sailing-selection actions concurrently, then surface the banner immediately. If ntfy is slow or temporarily unavailable, the browser still moves to the right sailing without waiting.

### 5. Preserve preference order but treat any Monday reservation as insurance

Keep the existing preference ordering:

1. Monday 9/14 05:00–11:00.
2. Sunday 9/13 16:00–23:59.
3. Monday 9/14 11:01–23:59.

One strategic addition: once an acceptable late-Monday reservation is obtained, continue looking for a better Monday reservation if the system can safely distinguish an already-held fallback from the desired upgrade. A late Monday slot is not merely a bad itinerary; it also supports earlier same-day standby attempts while capping the downside of being stranded on Orcas.

### 6. Add explicit health checks before each critical window

Because this project has already exposed silent-failure modes, critical windows should have an observable preflight rather than assuming a green workflow means the whole path works.

At T-10 minutes, verify and report:

- login succeeded;
- route/date/vehicle form is primed;
- availability refresh works;
- ntfy test delivery succeeded recently;
- browser/session is still alive;
- the correct target date is active.

A working preflight should produce one concise “READY” state. Failure should identify the exact broken component rather than merely say the workflow failed.

## Exact operational sequence

### Friday 9/11 — Sunday fallback release

Use the existing 7:00 a.m. release sniper for Sunday 9/13. Also have the local visible-browser mode running so that if the local watcher sees inventory, it can leave the correct sailing selected at the CAPTCHA.

### Saturday 9/12 — Monday preferred release

Use the existing 7:00 a.m. release sniper for Monday 9/14. Preferred target remains Monday morning; any Monday sailing remains useful as fallback insurance.

### Saturday 9/12 — Sunday cancellation wave

Run the focused cancellation window centered on **5:00 p.m. PT** against Sunday 9/13.

### Sunday 9/13 — Monday cancellation wave

Run the focused cancellation window centered on **5:00 p.m. PT** against Monday 9/14. This deserves the highest cancellation-watching priority because it is directly tied to the preferred Monday-morning travel date.

### After 5 p.m.

Keep ordinary cancellation watching running. WSF allows one final reservation change after 5 p.m., so inventory can continue to reshuffle after the main deadline cluster.

## Two WSF questions still worth confirming by phone

1. For Orcas → Anacortes on Monday Sept. 14, if a traveler holds a later reservation and boards an earlier sailing through standby, exactly what happens to the later reservation and what must be told to the ticket seller to avoid a no-show fee?
2. Which lockout applies in September 2026 for Anacortes/San Juan reservations: the current live page's two hours or the older Terms PDF's three hours?

## What I can build better on top of Claude's current implementation

The existing architecture is fundamentally useful. The concrete upgrade I would make is **targeted cancellation-window intelligence**, not a rewrite:

- add the 5 p.m. deadline windows to config;
- add a `--window` mode to the local visible-browser watcher;
- temporarily tighten polling only during those windows;
- make browser selection and phone alert happen in parallel;
- add a critical-window preflight/READY signal;
- retain the existing cloud watcher and release sniper as independent coverage.

That combination should improve the probability of catching returned space while preserving the work already completed.