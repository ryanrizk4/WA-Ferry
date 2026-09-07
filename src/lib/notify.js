// Getting the outcome of a run to a human.
//
// This is not an "instead of booking" alert — the point of the tool is to book.
// It is how you find out that it booked (and with what confirmation number),
// or that it tried and failed and you need to go do it by hand right now.
//
// Two channels, both optional, both fire-and-forget: a failure to notify must
// never take down a run that is mid-booking.

// Set by the watcher when the sailing it alerted about is no longer open, so
// the repeats stop instead of nagging about a chance that has passed.
let stopRepeating = false;
// Each urgent push starts a repeat loop, and a later one must supersede the
// earlier rather than run beside it. Without this, alerting once a minute
// about a sailing that stays open would stack loop on loop and turn a useful
// alarm into something that gets the app muted.
let repeatGeneration = 0;
export function callOffRepeats() { stopRepeating = true; repeatGeneration += 1; }
export function resumeRepeats() { stopRepeating = false; }

const gh = {
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPOSITORY,
};

async function openIssue(title, body) {
  if (!gh.token || !gh.repo) return 'skipped (no GITHUB_TOKEN/REPOSITORY)';
  const res = await fetch(`https://api.github.com/repos/${gh.repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${gh.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title, body }),
  });
  return res.ok ? `issue #${(await res.json()).number}` : `failed (${res.status})`;
}

// The title travels as an HTTP header, and headers are bytes, not text. A
// single curly quote or dash above U+00FF makes the request throw before it is
// ever sent, which means no notification at all — silently, and looking
// exactly like "nothing was available". Learned by sending a test push whose
// title contained an em dash and watching it vanish.
function asciiHeader(s) {
  return String(s)
    .replace(/[\u2012-\u2015\u2212]/g, '-')   // dashes
    .replace(/[\u2018\u2019\u201B]/g, "'")    // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')          // curly double quotes
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '')             // anything else non-printable-ASCII
    .trim();
}

// Tapping an alert at 3 a.m. should land on the booking page, not on a home
// screen to be navigated half-asleep.
const BOOKING_URL =
  'https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/SailingSchedule.aspx';

// One push is easy to miss, and that is not a theory any more. On 7 September
// the watcher found space on the 8:50 a.m. Monday sailing, the single most
// wanted boat of the trip, and sent the alert at 11:57:58. It was seen too
// late and the space was gone.
//
// The priority was already at maximum and still is: ntfy's "urgent" is its
// level 5, and there is nothing above it. So the fix is not priority, it is
// persistence. Three buzzes over fifty seconds is a thing you can miss by
// being in another room. Twenty-four buzzes over six minutes is not.
//
// The repeats stop early if the space is gone, because the watcher re-checks
// between them and only keeps alerting while there is still something to act
// on. Nothing here is worth alarming somebody about after the chance has
// passed.
const URGENT_REPEATS = 24;
const REPEAT_GAP_MS = 15_000;

// A ringing phone beats a notification, and ntfy will place an actual phone
// call for a priority-5 message. It needs a paid ntfy account with a verified
// number, so it is off unless NTFY_CALL_NUMBER is set, and its absence
// changes nothing.
const CALL_NUMBER = process.env.NTFY_CALL_NUMBER;

// ntfy.sh delivers a push to a phone with no account, given a topic name that
// is unguessable enough to act as its own secret.
async function pushNtfy(title, body, priority) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return 'skipped (no NTFY_TOPIC)';
  const urgent = priority === 'high';
  const send = (t, extra = {}) => fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      title: t.slice(0, 200),
      // "urgent" is ntfy's top priority, its level 5. On a phone that means it
      // can ring through a silenced ringer, but only if the ntfy app has been
      // allowed to: iOS needs notifications set to Time Sensitive, Android
      // needs the channel exempted from Do Not Disturb. Nothing sent from this
      // end can force that; it is a setting on the phone.
      priority: urgent ? 'urgent' : 'default',
      tags: urgent ? 'ferry,rotating_light' : 'ferry',
      // Makes the notification itself a link straight to the search page.
      click: BOOKING_URL,
      ...extra,
    },
    body: body.slice(0, 3000),
  });

  // Ring the phone once, on the first urgent push only. Repeated calls would
  // be worse than useless: the phone is engaged while it rings, which is
  // exactly when somebody is trying to use it to book.
  if (urgent && CALL_NUMBER) {
    send(asciiHeader(title), { 'x-call': CALL_NUMBER }).catch(() => {});
  }

  // Repeats go out after the first one has landed, and deliberately without
  // being awaited: this is often called while a booking is in flight, and
  // nothing here is allowed to slow that down or to throw into it.
  if (urgent) {
    const mine = ++repeatGeneration;
    (async () => {
      for (let i = 1; i < URGENT_REPEATS; i++) {
        await new Promise((r) => setTimeout(r, REPEAT_GAP_MS));
        // Stop if the space is gone, or if a newer alert has taken over.
        if (stopRepeating || mine !== repeatGeneration) return;
        await send(asciiHeader(title)).catch(() => {});
      }
    })().catch(() => {});
  }

  try {
    const res = await send(asciiHeader(title));
    return res.ok ? 'ntfy ok' : `ntfy failed (${res.status})`;
  } catch (e) {
    // A bare title beats no notification. Whatever went wrong with the text,
    // the push still has to land.
    try {
      const res = await send('Ferry space open - check now');
      return res.ok
        ? `ntfy ok (fallback title after: ${e.message.slice(0, 60)})`
        : `ntfy failed (${res.status})`;
    } catch (e2) {
      return `ntfy threw twice: ${e2.message.slice(0, 80)}`;
    }
  }
}

export async function notify({ title, body, priority = 'normal', issue = true }) {
  console.log(`\n=== NOTIFY: ${title} ===\n${body}\n`);
  const results = await Promise.allSettled([
    issue ? openIssue(title, body) : Promise.resolve('issue suppressed'),
    pushNtfy(title, body, priority),
  ]);
  console.log(`notify results: ${results.map((r) => r.value ?? r.reason).join(' | ')}`);
}
