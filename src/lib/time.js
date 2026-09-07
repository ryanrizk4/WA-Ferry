// Pacific-time helpers.
//
// Every time WSF publishes — sailing departures, release waves — is local
// Pacific, and the runner this executes on is UTC. Getting this wrong by an
// hour means missing the release entirely, so the conversion is done through
// Intl rather than by hand.

import { TZ } from '../config.js';

// Wall-clock parts of an instant, in Pacific.
export function partsPT(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
    hhmm: `${p.hour}:${p.minute}`,
  };
}

export const nowPT = () => { const p = partsPT(); return `${p.date} ${p.time}`; };

// Pacific's UTC offset on a given instant, in minutes. Derived by asking what
// the same instant looks like in Pacific and comparing, which stays correct
// across the DST boundary instead of assuming -7 or -8.
function offsetMinutes(d) {
  const p = partsPT(d);
  const asUTC = Date.UTC(
    ...p.date.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)),
    ...p.time.split(':').map(Number),
  );
  return (asUTC - d.getTime()) / 60000;
}

// Turn a Pacific wall-clock string ("2026-09-11T07:00:00" or
// "2026-09-11 07:00") into a real instant.
export function fromPT(wall) {
  const [datePart, timePart = '00:00:00'] = wall.trim().split(/[T ]/);
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, s = 0] = timePart.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes: the offset itself depends on the instant we are resolving.
  let guess = new Date(naive);
  for (let i = 0; i < 2; i += 1) guess = new Date(naive - offsetMinutes(guess) * 60000);
  return guess;
}

export const msUntil = (wallPT) => fromPT(wallPT).getTime() - Date.now();

// "5h 12m 03s" — for logs, so a run's timing is auditable after the fact.
export function humanDuration(ms) {
  if (ms < 0) return `${humanDuration(-ms)} ago`;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${String(s % 60).padStart(2, '0')}s`;
}

// Does a sailing's departure fall inside a target's window?
export function inWindow(departHHMM, earliest, latest) {
  const n = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return n(departHHMM) >= n(earliest) && n(departHHMM) <= n(latest);
}
