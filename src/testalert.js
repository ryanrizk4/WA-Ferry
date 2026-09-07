// Sends one notification, so the alert path is proven before it matters.
//
// The whole value of this project is a push landing on a phone within seconds
// of space appearing at 7 a.m. A topic name typed slightly wrong, or a phone
// that never subscribed, fails silently and looks exactly like "no space came
// up". Better to find that out now than on Friday.

import { notify } from './lib/notify.js';

await notify({
  title: 'WA-Ferry test — this is what a real alert looks like',
  body: 'If this reached your phone, the alerting path works and you are set.\n\n'
    + 'The real one will name the sailing and date, and link straight to the '
    + 'booking page. It fires the moment space appears, which in practice means '
    + '7:00 a.m. Pacific on Fri Sept 11 (for Sunday the 13th) and Sat Sept 12 '
    + '(for Monday the 14th), or any time a cancellation shows up.\n\n'
    + 'Nothing is booked. This is only a test.',
  priority: 'high',
  issue: false,
});
