// Proves the alert path works, including the phone call, before it matters.
//
// The whole value of this project is a push landing on a phone within seconds
// of space appearing. A topic typed slightly wrong, a phone that never
// subscribed, or a call number that was never verified all fail silently and
// look exactly like "no space came up".
//
// This is a test, so it deliberately does NOT run the full alarm a
// real alert runs. It sends the push, places the call if one is configured,
// lets a couple of repeats through so their timing can be felt, and then
// calls the rest off.

import { notify, callOffRepeats } from './lib/notify.js';

const callConfigured = Boolean(process.env.NTFY_CALL_NUMBER);

console.log(`phone call configured: ${callConfigured}`);
if (!callConfigured) {
  console.log('  NTFY_CALL_NUMBER is not set, so no call will be placed.');
  console.log('  Add it as a repository secret to enable calls. It needs a paid');
  console.log('  ntfy plan with a call allowance and a number verified in ntfy.');
}

await notify({
  title: 'WA-Ferry test - alert path check',
  body: 'If this reached your phone, the alerting path works.\n\n'
    + (callConfigured
      ? 'Your phone should also RING, once, like a normal call. That is the '
        + 'escalation for the real thing: a call is much harder to sleep '
        + 'through than a notification.\n\n'
      : 'No phone call was placed, because no call number is configured.\n\n')
    + 'You should get two or three more buzzes about fifteen seconds apart, '
    + 'then it stops. A real alert buzzes ten times over about two and a half '
    + 'minutes, or until the space is gone.\n\n'
    + 'The real one names the sailing and date and links straight to the '
    + 'booking page. Nothing is booked. This is only a test.',
  priority: 'high',
  issue: false,
});

// Let a few repeats through so the cadence is familiar, then stop. Six minutes
// of buzzing is right for a real chance and obnoxious for a test.
await new Promise((r) => setTimeout(r, 40_000));
callOffRepeats();
console.log('test alarm called off after 40s (a real one is ten buzzes over ~2.5 min)');
