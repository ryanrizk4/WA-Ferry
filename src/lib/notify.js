// Getting the outcome of a run to a human.
//
// This is not an "instead of booking" alert — the point of the tool is to book.
// It is how you find out that it booked (and with what confirmation number),
// or that it tried and failed and you need to go do it by hand right now.
//
// Two channels, both optional, both fire-and-forget: a failure to notify must
// never take down a run that is mid-booking.

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

// One push is easy to sleep through, and a missed cancellation is the whole
// failure mode this project exists to prevent. Urgent alerts are therefore
// repeated: same message, a few times, a short gap apart. Three is enough to
// beat a phone face-down on a nightstand without becoming its own problem.
const URGENT_REPEATS = 3;
const REPEAT_GAP_MS = 25_000;

// ntfy.sh delivers a push to a phone with no account, given a topic name that
// is unguessable enough to act as its own secret.
async function pushNtfy(title, body, priority) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return 'skipped (no NTFY_TOPIC)';
  const urgent = priority === 'high';
  const send = (t) => fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      title: t.slice(0, 200),
      // 'urgent' is ntfy's top priority. On a phone that means it can ring
      // through a silenced ringer, but only if the ntfy app itself has been
      // allowed to: iOS needs notifications set to Time Sensitive, Android
      // needs the channel exempted from Do Not Disturb. Nothing sent from
      // this end can force that; it is a setting on the phone.
      priority: urgent ? 'urgent' : 'default',
      tags: urgent ? 'ferry,rotating_light' : 'ferry',
      // Makes the notification itself a link straight to the search page.
      click: BOOKING_URL,
    },
    body: body.slice(0, 3000),
  });

  // Repeats go out after the first one has landed, and deliberately without
  // being awaited: this is often called while a booking is in flight, and
  // nothing here is allowed to slow that down or to throw into it.
  if (urgent) {
    (async () => {
      for (let i = 1; i < URGENT_REPEATS; i++) {
        await new Promise((r) => setTimeout(r, REPEAT_GAP_MS));
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
      return res.ok ? `ntfy ok (fallback title after: ${e.message.slice(0, 60)})` : `ntfy failed (${res.status})`;
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
