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

// ntfy.sh delivers a push to a phone with no account, given a topic name that
// is unguessable enough to act as its own secret.
async function pushNtfy(title, body, priority) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return 'skipped (no NTFY_TOPIC)';
  const send = (t) => fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      title: t.slice(0, 200),
      priority: priority === 'high' ? 'urgent' : 'default',
      tags: priority === 'high' ? 'ferry,tada' : 'ferry',
    },
    body: body.slice(0, 3000),
  });

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
