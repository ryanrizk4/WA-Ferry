# Booking from a phone

There will be no laptop on this trip. When the alert arrives, the whole
booking has to happen on a phone, against a clock, possibly at three in the
morning. This is the plan for that, worked out in advance so none of it is
being figured out while the space disappears.

## The one thing that matters most

**Leave a search already loaded on the phone.**

The single biggest cost in a phone booking is not tapping the sailing or
solving the captcha. It is re-entering the route, the date and the vehicle
size, on a site whose sailing page **cannot be deep-linked** — every
query-parameter shape was tried and ignored, so tapping the notification opens
an empty search form, not a list of sailings.

But once a search has been run, the "Show Availability" button is replaced by
**Refresh**, which re-runs the same query in a single postback. So a phone
with the search already sitting on screen turns a forty-second scramble into:

> Refresh → tap the sailing → tick the captcha → Add to Cart

Set it up on Saturday evening. Leave the tab open. Do not close it, and do not
let the phone kill the tab overnight if you can help it.

The session does time out ("Cart Timeout" is on the page), so if the tab has
been sitting for hours, expect the first Refresh to bounce you back to the
form. That still beats starting from a cold browser, and it is why the rest of
this page exists.

## Which site you will get

WSF does not serve phones a narrow version of its desktop site. It serves a
**different site**, confirmed by driving both:

| | Phone (default) | "Full Site" / Request Desktop |
|---|---|---|
| Controls | `MobileMainContent_*` | `MainContent_*` |
| Fits the screen | Yes, 393px in 393px | No, 1040px in a 980px window |
| Radio buttons | see below | 13x13 pixels, against a 44px thumb target |
| Verified end to end | being mapped | **yes**, including the sailing list |

Both are reachable from a phone. There is a **"Full Site"** link at the bottom
of the mobile page, and Safari's Request Desktop Website does the same thing.

**Use the desktop site unless the mobile map says otherwise.** It is the flow
that has been driven end to end and whose every quirk is written down. The
mobile site is better proportioned but unproven, and Sunday night is not when
to find out that something behaves differently.

The desktop site's 13-pixel radio buttons are the real cost of that choice.
Zoom in before you need to tap one. Practise it.

## The sequence

Everything below is the same on both sites; only the layout differs.

1. **Route.** Departing From: **Orcas Island**. Wait for the arriving list to
   repopulate before touching it, then Arriving At: **Anacortes**. The second
   list is filled in by the server after the first is chosen; tapping too
   early gets you a list that does not have Anacortes in it yet.

2. **Date.** The box has `maxlength="8"` and wants **M/D/YY**:
   - Monday: `9/14/26`
   - Sunday: `9/13/26`

   A four-digit year is silently truncated and then rejected as an invalid
   date. This cost a day to find. Do not type `2026`.

3. **Vehicle.** Length: **Vehicle under 22 feet**. Then Height: **Up to 7'2"
   tall**. Both are required — setting only the length gets "Please Select
   Vehicle Height" and no results.

4. **Show Availability**, or **Refresh** if a search has already run.

5. **Read the list.** A sailing is bookable when its radio button is *live*.
   A greyed-out radio means nothing to reserve. **"More Info..." means sold
   out** — it is WSF's wording for "no space now, more at the next release",
   not an invitation. Do not waste seconds tapping it.

6. **Tap the sailing**, tick **"I'm not a robot"**, then **Add to Cart** and
   check out. The account has a saved payment method, so checkout is short.

## What you are aiming for, in order

1. **Monday 14 Sept, 05:00-11:00** — the goal. Sailings in range: 7:05 AM,
   8:50 AM.
2. **Sunday 13 Sept, 16:00-23:59** — the fallback. 5:25 PM, 9:25 PM, 10:45 PM.
3. **Monday 14 Sept, 11:01-23:59** — last resort, but take it. 12:15 PM,
   2:20 PM, 5:25 PM, 9:25 PM, 10:45 PM.

Take anything in group 1. If the alert is for group 2 or 3, take it anyway:
the whole point of having a last resort is being able to get off the island.

**Do not book a second one as a hedge.** WSF charges a no-show fee on an
unused reservation. One booking, then stand down — the watcher stops by
itself once it sees a reservation exists.

## The alert

Notifications come through the ntfy app, at urgent priority, repeated three
times twenty-five seconds apart, with a link straight to the sailing page.

**Check this before Saturday**, because an alert nobody hears is the same as
no alert:

- The ntfy app is installed and subscribed to the topic.
- Notifications for it are set to **Time Sensitive** on iOS, or exempted from
  Do Not Disturb on Android. Nothing sent from the server side can force a
  silenced phone to ring; that is a setting on the phone.
- Send yourself a test push and confirm it arrives, loudly, with the screen
  locked.

## When the moments are

| When (Pacific) | What |
|---|---|
| Fri 11 Sept, 7:00 a.m. | Two-day release for Sunday's sailings |
| Sat 12 Sept, 7:00 a.m. | Two-day release for Monday's sailings |
| Sat 12 Sept, 5:00 p.m. | Penalty-free cancellation deadline for Sunday |
| Sun 13 Sept, 5:00 p.m. | Penalty-free cancellation deadline for Monday |
| Mon 14 Sept, ~5:05 a.m. | Last cancellations before the 7:05 a.m. sailing locks |

The two cancellation deadlines are the best odds of the week. People who are
not travelling give their space back to avoid the fee, and WSF allows one
final change afterwards at no charge, which is why space keeps trickling out
after 5 p.m. rather than stopping dead.

Nothing can be cancelled less than **two hours** before a sailing, so after
about 5:05 a.m. on Monday the only space that frees up is a no-show, and that
happens at the tollbooth rather than on the website.

## If nothing ever comes

Vehicles going to Anacortes from **Lopez** or **Shaw** are not reservable at
all; they load first come, first served, and interisland sailings within the
San Juans do not take vehicle reservations either. Orcas to Lopez or Shaw,
then Lopez or Shaw to Anacortes, is a queueing problem instead of a lottery.

The catch is real: the Anacortes-bound boat calls at the islands in sequence
and reaches Lopez already carrying reserved vehicles from Orcas and Friday
Harbor, so space can be thin and a bad day means waiting for the next
sailing. Check the interisland schedule in advance, because the connection has
to work. But it is a way off the island that does not depend on beating anyone
to a button.
