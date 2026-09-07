// Has a reservation already been made?
//
// Runners are ephemeral and the watch keeps polling after a success, so
// without this a second run could happily book a second sailing — and an
// unused reservation earns a no-show fee. The record of success is the issue
// the booker opens, which survives between runs and is visible to a human.

const gh = {
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPOSITORY,
};

export const BOOKED_PREFIX = 'Booked:';

export async function alreadyBooked() {
  if (!gh.token || !gh.repo) return { known: false, reason: 'no GitHub token; cannot check' };
  try {
    const res = await fetch(
      `https://api.github.com/repos/${gh.repo}/issues?state=all&per_page=50`,
      { headers: { authorization: `Bearer ${gh.token}`, accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return { known: false, reason: `issue lookup failed (${res.status})` };
    const hit = (await res.json()).find((i) => i.title?.startsWith(BOOKED_PREFIX));
    return hit
      ? { known: true, booked: true, title: hit.title, url: hit.html_url }
      : { known: true, booked: false };
  } catch (e) {
    return { known: false, reason: `issue lookup errored: ${e.message}` };
  }
}
