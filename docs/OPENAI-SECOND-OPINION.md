# OpenAI operational second opinion — Orcas → Anacortes

Date checked: 2026-09-07

## Bottom line

The best legitimate path is **human booking at the release/cancellation moments**, not an automated Playwright watcher. WSF's current Acceptable Use Policy expressly prohibits automated processes that simulate a human making a reservation and prohibits consuming site resources that way. The existing 45-second watcher and especially the 1-second release poll create a real account/access risk even though the CAPTCHA prevents final checkout.

The strongest newly verified timing edge is **5:00 p.m. PT the day before travel**. WSF itself tells customers that this is a good time to check because it is the deadline to cancel without a no-show fee. For this trip that creates two high-value windows:

- **Saturday 2026-09-12, about 4:40–5:15 p.m. PT** — cancellations for Sunday 9/13 sailings.
- **Sunday 2026-09-13, about 4:40–5:15 p.m. PT** — cancellations for Monday 9/14 sailings. This is the single most important cancellation window for the preferred Monday morning target.

The published two-day releases remain critical:

- **Friday 2026-09-11 at 7:00:00 a.m. PT** — Sunday 9/13 inventory.
- **Saturday 2026-09-12 at 7:00:00 a.m. PT** — Monday 9/14 inventory.

## Facts verified against the live WSF site

1. Anacortes/San Juan standard-vehicle inventory is released 30% season-opening, 30% two weeks out, 30% two days out, with the last 10% kept for emergency/standby.
2. WSF says reservation holders should arrive 45–60 minutes early and must check in at least 30 minutes before sailing.
3. WSF says customers without the desired reservation should check frequently; **around 5:00 p.m. the day before is specifically called out** because that is when people can cancel without a no-show fee.
4. Current WSF FAQ says reservations must be changed/canceled before **5:00 p.m. PT the day before** to avoid a no-show fee.
5. Current WSF page says one final change is allowed after 5:00 p.m. the day before, and says no changes/cancellations can be made less than **two hours** before the reserved sailing.
6. An older WSF Terms/Conditions PDF says the Anacortes/San Juan lockout is **three hours**. Because the current live page says two hours, treat two hours as the working rule but recognize this conflict. Do not build a plan that depends on the last hour of that discrepancy.
7. Customer Service is 888-808-7977 (or 206-464-6400), 7:00 a.m.–5:30 p.m. PT daily. WSF explicitly says staff cannot see hidden inventory or save space; if the website shows none, they cannot see any either.
8. WSF's Acceptable Use Policy says users may not employ automated processes/bots to simulate human reservation actions to evade program controls, and may not consume site resources by simulating human reservation behavior.

## Operational plan I would run

### A. Friday 9/11 — Sunday fallback release

At **6:50 a.m. PT**, manually open the reservation site in a normal browser. Sign in, choose Orcas Island → Anacortes, date 9/13/26, standard vehicle under 22 ft / up to 7'2, and get to the sailing list.

At **6:59:55**, stop doing anything else. At **7:00:00**, press Refresh. If any acceptable Sunday 4:00 p.m.–11:59 p.m. sailing appears, select it immediately, solve the CAPTCHA, Add to Cart, and finish checkout.

Do not wait for an alert from a bot before acting. The human page is the fastest compliant signal.

### B. Saturday 9/12 — Monday preferred release

Repeat the same setup for **Monday 9/14**. At **7:00:00 a.m. PT**, Refresh and take the first sailing in this order:

1. Monday 5:00–11:00 a.m.
2. Monday 11:01 a.m.–11:59 p.m.

If a last-resort Monday reservation is available, take it. A later guaranteed reservation is useful insurance because WSF allows a customer with a reservation to arrive for an earlier sailing the same day and travel standby; tell the ticket seller so the later reservation does not generate a no-show fee. This does **not** give priority in the standby line, but it caps the downside of being stranded.

### C. Saturday 9/12 — Sunday cancellation deadline

From **4:40–5:15 p.m. PT**, manually refresh the 9/13 search periodically. This is the first empirically justified cancellation-spike window, not merely a guess: WSF tells customers to check around 5 p.m. for exactly this reason.

### D. Sunday 9/13 — the most important cancellation window

From **4:30–5:20 p.m. PT**, focus exclusively on Monday 9/14. Keep the page already configured. Refresh manually and book the first Monday-morning reservation that appears.

I would prioritize this window above random all-day polling because the mechanism is clear: people avoiding the no-show fee have an incentive to cancel before 5 p.m.

### E. Late-change mini-windows

After 5 p.m. the day before, WSF allows one final change. That means inventory can still return when customers move from one sailing to another. These returns are likely smaller and more dispersed than the 5 p.m. cancellation wave.

For a specific desired sailing, check again before its lockout. Use a conservative cutoff of **three hours before departure** because WSF's older terms say three hours even though the current live FAQ says two. The discrepancy makes a strategy built on 2:00–3:00 hours-before too fragile.

## Structural improvements vs the current repo

### 1. Do not treat the Playwright watcher as production-safe

The current architecture successfully detects availability, but its normal behavior is exactly the kind of automated reservation-site simulation WSF's current policy warns against. A CAPTCHA bypass would make that worse, not solve the policy problem.

Recommendation: keep the code only as a research/test artifact. Disable scheduled production polling against WSF. Do not add stealth, CAPTCHA solvers, rotating IPs, alternate endpoints, or browser-fingerprint evasion.

### 2. Shift the product from 'watcher' to 'human race console'

The highest-value automation should be **off-site**:

- exact alarms/countdowns for 7:00 a.m. and 5:00 p.m. windows;
- a one-click link to WSF;
- the route/date/vehicle settings printed in large text;
- a preference list of acceptable sailings;
- an audible alert at T-60, T-10, and T=0;
- no automated form submission, polling, or reservation-site requests.

This removes the policy/account-risk while preserving nearly all of the practical speed advantage: the actual bottleneck after space appears is the human CAPTCHA and final selection anyway.

### 3. Treat a late Monday reservation as insurance, not failure

If any Monday reservation appears, booking it is rational even if it is outside the preferred morning window. It guarantees eventual exit and permits same-day earlier standby attempts. If a better Monday reservation later appears, change/cancel according to WSF's current rules rather than holding duplicate reservations and risking no-show fees.

### 4. Phone support is a backup, not a primary acquisition channel

Calling WSF is legitimate but not a hidden-inventory trick. Their live page explicitly says agents cannot save space and cannot see openings that the customer cannot see. Use the phone for rule clarification or if the website itself fails, not as the main race strategy.

## Captcha position

I agree with Claude's refusal to bypass it, but for a broader reason than just fairness: even before the CAPTCHA, WSF's current Acceptable Use Policy makes sustained bot-driven reservation-site interaction risky. The safe line is to automate reminders and preparation **outside** WSF and keep the actual WSF interaction human-driven.

## What I would ask WSF by phone on 9/7 or 9/8

Ask only questions that could change the fallback plan:

1. 'For Orcas → Anacortes on Monday Sept. 14, if I hold a later reservation and arrive for an earlier sailing, am I simply placed in the normal standby queue, and will using standby earlier preserve/cancel the later reservation automatically?'
2. 'Your current web FAQ says no changes/cancellations less than two hours before sailing, while an older Terms PDF says three hours for Anacortes/San Juan. Which rule applies in September 2026?'
3. 'If I have a Monday reservation and travel an earlier Monday sailing by standby, exactly what must I tell the ticket seller to avoid a no-show fee?'

Do **not** expect the agent to produce inventory or reserve a sold-out sailing; WSF says they cannot.

## What would count as success

- Best case: Monday morning reservation obtained at the 9/12 7 a.m. release.
- Second-best: Monday morning reservation obtained in the 9/13 ~5 p.m. cancellation wave.
- Third-best: Sunday evening fallback reservation.
- Safety-net: any Monday reservation plus an early arrival for same-day standby.

A failed 7:00 a.m. release is **not** evidence that the trip is lost. The 5:00 p.m. day-before cancellation window is an independently justified second shot, and late changes can continue to release inventory after that.
