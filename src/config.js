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
  { at: '2026-09-11T07:00:00', kind: 'release', wave: 'two-day release for Sunday Sept 13' },
  { at: '2026-09-12T07:00:00', kind: 'release', wave: 'two-day release for Monday Sept 14' },

  // The other kind of moment worth being awake for, and possibly the better
  // one. WSF's own FAQ tells people to check the site the day before their
  // preferred sailing, "which is when people can cancel without a no-show
  // fee". So there is a penalty-free cancellation cutoff the day before, and
  // people who know they are not travelling give their space back before it.
  //
  // Space comes back across that whole day, not in one burst: someone who
  // cancels at ten in the morning has dodged the fee just as well as someone
  // who cancels at five. The peak is worth sprinting at, but the day around it
  // is worth watching hard too, which the watch taper handles separately.
  //
  // Fewer people know to look here than at 7 a.m., which is exactly what makes
  // it valuable.
  { at: '2026-09-12T17:00:00', kind: 'cancellation', wave: 'cancellation deadline for Sunday Sept 13' },
  { at: '2026-09-13T17:00:00', kind: 'cancellation', wave: 'cancellation deadline for Monday Sept 14' },

  // The last moment anyone can hand back a Monday-morning seat.
  //
  // WSF, verbatim: "No changes or cancellations can be made less than two
  // hours before your reserved sailing." So the 7:05 a.m. Monday sailing stops
  // accepting cancellations at 5:05 a.m., and the 8:50 at 6:50. After that the
  // only thing that frees a space is a no-show, which shows up at the terminal
  // rather than on the website.
  //
  // Between 5 p.m. Sunday and those cutoffs there is also a steady trickle,
  // because WSF allows one final change after the deadline at no charge, and
  // every person who moves to a different sailing releases the one they left.
  { at: '2026-09-14T04:50:00', kind: 'final-cutoff', wave: 'last chance for Monday morning space before the two-hour lockout' },
];

// Verified from WSF's own reservation FAQ on 2026-09-07:
//   - change or cancel before 5:00 p.m. PT the day before travel, or pay a
//     no-show fee;
//   - one final change allowed after that, free, but cancelling after it still
//     incurs the fee;
//   - nothing can be changed or cancelled inside two hours of the sailing;
//   - multiple reservations are allowed, but an unused one earns a no-show fee,
//     which is why this never books a second sailing as a hedge.
export const cancellationRules = {
  deadlineLocal: '17:00',
  lockoutHoursBeforeSailing: 2,
};

// Politeness and safety limits. These are not negotiable knobs to crank: WSF
// runs this on public infrastructure, and hammering it is both rude and the
// fastest way to get an IP range blocked right before the moment that matters.
export const limits = {
  // Cancellation watching. Each triggered run polls for a while rather than
  // checking once and quitting, because the trigger only fires hourly and a
  // single glance an hour catches almost nothing.
  //
  // How long it keeps looking scales with how close the trip is. Cancellations
  // cluster as people finalise plans, and Actions minutes are finite, so the
  // budget goes where the odds are rather than being spread evenly across a
  // week of nothing.
  idlePollMs: 45_000,

  // How long each triggered run keeps looking.
  //
  // Sized for how unreliably the trigger fires, not for how often we would
  // like to check. GitHub's scheduler managed two runs in ten hours against a
  // every-fifteen-minutes cron, so a run that checks once and quits would
  // cover seconds out of a day. Each run therefore holds the line for a while,
  // and the concurrency group makes a newer run supersede an older one so
  // overlapping triggers cost nothing extra.
  // Tiered so the expensive setting only applies near the trip. Two schedules
  // now trigger this, and a newer run cancels an older one, so whenever the
  // trigger interval is shorter than the run length the watcher is effectively
  // running continuously. That is affordable for a day and not for a week,
  // hence the steep taper. Roughly 1,900 Actions minutes across the week in
  // the worst case, against a 2,000 monthly allowance.
  // How long one run watches when minutes are free. Just under GitHub's six
  // hour job ceiling, so a chain of these is continuous cover.
  continuousRunMs: 5.5 * 60 * 60_000,

  watchWindows: [
    { withinHours: 24, runForMs: 45 * 60_000 },   // the day-before days
    { withinHours: 48, runForMs: 15 * 60_000 },
    { withinHours: Infinity, runForMs: 5 * 60_000 },
  ],

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
