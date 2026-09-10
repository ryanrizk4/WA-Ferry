# Retired workflows

These eight workflow files ran the ferry watch between 7 and 10 September 2026.
They are parked here rather than deleted, because a file in this directory
cannot start a run: GitHub only executes workflows that live in
`.github/workflows/`. The code they call still sits in `src/`, so reviving the
whole system is a matter of moving these files back and updating the dates in
`src/config.js`.

The trip they were built for is settled. Both legs off Orcas were reserved by
hand on 9 September off alerts these workflows sent.

What each one did:

- `watch.yml`, `watch2.yml` — the continuous cancellation watch. Each run
  polled the reservation site for about five and a half hours and dispatched
  its own successor before exiting, so the chain did not depend on GitHub's
  cron, which proved unreliable here.
- `snipe.yml` — fired at the 7 a.m. two-day release and at the 5 p.m.
  cancellation deadlines, the two moments when space is most likely to appear.
- `check.yml` — a single on-demand availability check.
- `drill.yml`, `testalert.yml` — live-fire tests of the phone alert. Neither
  could book anything.
- `rehearsal.yml` — a dry run of the release-time sprint against a fake
  release time.
- `diag.yml` — the page-structure probe used to map the site, including the
  separate mobile version WSF serves to phones.

Two things to know if this is ever revived:

The repository secrets (`WSF_EMAIL`, `WSF_PASSWORD`, `NTFY_TOPIC`,
`NTFY_CALL_NUMBER`) are what these workflows signed in with. Nothing reads them
while the workflows are parked here, but they are still stored on the
repository and can be removed in Settings, Secrets and variables, Actions.

Nothing here ever completed a booking, by design. WSF enforces a reCAPTCHA on
their own server, so the system's job ended at spotting space and getting a
push notification out fast enough for a human to finish.
