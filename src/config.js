// The trip we are trying to book, and the rules for how hard to try.
//
// Everything here is data. If the plan changes, this is the only file that
// needs editing.

export const trip = {
  // Anacortes/San Juan Islands route. Terminal IDs are WSDOT's own; the
  // names are what the reservation site shows in its terminal pickers.
  from: { id: 15, name: 'Orcas Island' },
  to: { id: 1, name: 'Anacortes' },

  // "Car under 22 feet" — the standard vehicle category, and the one with the
  // most reservable slots per sailing.
  vehicle: { lengthCategory: 'under-22', heightOver7ft: false, driverPlusPassengers: 1 },

  // Sailings we would accept, best first. The booker walks this list in order
  // and takes the first thing that is actually available, so a worse option
  // still beats no option.
  //
  // Times are local Pacific, matched against the sailing's departure time.
  targets: [
    {
      label: 'Monday morning (preferred)',
      date: '2026-09-14',
      earliest: '05:00',
      latest: '11:00',
    },
    {
      label: 'Sunday evening (fallback)',
      date: '2026-09-13',
      earliest: '16:00',
      latest: '23:59',
    },
    {
      label: 'Late Monday (last resort)',
      date: '2026-09-14',
      earliest: '11:01',
      latest: '23:59',
    },
  ],
};

// Nothing to do after this; the watch stops rather than polling forever.
export const stopAfter = '2026-09-14T23:59:00';

// When WSF drops new inventory. Their published rule for the Anacortes/San
// Juan Islands route, in three phases:
//
//   two months before the season starts, 10 a.m. PT — 30% of standard spaces
//   two weeks before each sailing date, 7 a.m. PT   — another 30%
//   two days before each sailing date, 7 a.m. PT    — the last 30%
//
// The final 10% is held back for emergency and stand-by. The two-week wave for
// these dates has already passed, so the two-day wave is the one worth racing.
// A virtual waiting room guards the season-opening release only, not these.
//
// All times are America/Los_Angeles.
export const releases = [
  { at: '2026-09-11T07:00:00', wave: 'two-day release for Sunday Sept 13' },
  { at: '2026-09-12T07:00:00', wave: 'two-day release for Monday Sept 14' },
];

// Politeness and safety limits. These are not negotiable knobs to crank: WSF
// runs this on public infrastructure, and hammering it is both rude and the
// fastest way to get an IP range blocked right before the moment that matters.
export const limits = {
  // Gap between availability checks during ordinary cancellation watching.
  idlePollMs: 60_000,
  // Gap between checks during a release. The first minute is where a release
  // is won or lost, so poll hard then and ease off after: a steady one request
  // a second for half an hour is both rude and pointless once the rush clears.
  sprintPollMs: 1_000,
  sprintHardMs: 60_000,
  sprintEasedPollMs: 3_000,

  // Keep going well past the rush, because of how carts work. Space that
  // someone grabs and does not check out goes back on sale when their cart
  // expires, which is a second, quieter wave maybe fifteen to twenty-five
  // minutes after the release. Far fewer people are still watching by then,
  // so it is a better chance than the scramble at 7:00:00 even though it
  // feels like the afterthought.
  sprintWindowMs: 35 * 60_000,
  secondWaveAfterMs: 10 * 60_000,
  secondWavePollMs: 20_000,
  // Never attempt more than this many bookings in one run, whatever happens.
  maxBookingAttempts: 3,
};

export const TZ = 'America/Los_Angeles';
