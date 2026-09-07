# WA-Ferry

Gets a Washington State Ferries vehicle reservation for the ride home:
**Orcas Island to Anacortes**, Sunday Sept 13 or Monday Sept 14, 2026,
car under 22 feet.

## The problem this solves

WSF does not put all reservation space on sale at once. For the
Anacortes/San Juan Islands route it comes out in waves: a block when the
season's schedule opens, another two weeks before each sailing, another two
days before, at 7:00 a.m. Pacific. Popular sailings are gone within seconds
of a wave landing, which is why refreshing the page by hand loses.

The two-week wave for these dates has already passed. The two-day waves are:

| Wave | Fires | For sailings on |
|---|---|---|
| Two-day | Fri Sept 11, 7:00 a.m. PT | Sunday Sept 13 |
| Two-day | Sat Sept 12, 7:00 a.m. PT | Monday Sept 14 |

Between now and then, space also reappears at random as other people cancel.

## How it works

Everything runs on GitHub Actions, so nothing has to stay open on your laptop.

- **Sniper runs** start a few minutes before each wave, wait for the exact
  second, then hit availability hard for a short window and book the first
  acceptable sailing.
- **Watch runs** poll at a gentle interval the rest of the time, to catch
  cancellations.

Preference order lives in `src/config.js`: Monday morning first, Sunday
evening as a fallback. It takes the best thing actually available rather than
holding out.

## Files

| File | What it is |
|---|---|
| `src/config.js` | The trip, the dates, the release times, the rate limits. The only file to edit if plans change. |
| `src/lib/flow.js` | Drives the WSF reservation site's form. |
| `src/lib/time.js` | Pacific-time conversion. Getting this wrong by an hour means missing the wave. |
| `src/lib/notify.js` | Tells you what happened. |
| `src/recon.js` | Exploration script used to work out how the site behaves. |
