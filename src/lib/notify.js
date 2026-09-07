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

// ntfy.sh delivers a push to a phone with no account, given a topic name that
// is unguessable enough to act as its own secret.
async function pushNtfy(title, body, priority) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return 'skipped (no NTFY_TOPIC)';
  const res = await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      title: title.slice(0, 200),
      priority: priority === 'high' ? 'urgent' : 'default',
      tags: priority === 'high' ? 'ferry,tada' : 'ferry',
    },
    body: body.slice(0, 3000),
  });
  return res.ok ? 'ntfy ok' : `ntfy failed (${res.status})`;
}

export async function notify({ title, body, priority = 'normal', issue = true }) {
  console.log(`\n=== NOTIFY: ${title} ===\n${body}\n`);
  const results = await Promise.allSettled([
    issue ? openIssue(title, body) : Promise.resolve('issue suppressed'),
    pushNtfy(title, body, priority),
  ]);
  console.log(`notify results: ${results.map((r) => r.value ?? r.reason).join(' | ')}`);
}
