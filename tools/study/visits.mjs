/* Visit windows for the measurement study.
 *
 * Protocol §5: visit 2, for a subset, falls a configured number of days after visit 1. Dates are
 * calendar days (YYYY-MM-DD) with no time of day, so a window never shifts by a day depending on
 * the time zone of whoever opens the file — the failure this repository has hit before with "today".
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyVisitError', code }); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(iso) {
  if (typeof iso !== 'string' || !DAY.test(iso)) fail('BAD_DATE', 'Dates must be calendar days as YYYY-MM-DD; got ' + iso);
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  if (new Date(t).toISOString().slice(0, 10) !== iso) fail('BAD_DATE', 'Not a real calendar day: ' + iso);
  return t / 86400000;
}
const isoFromDay = n => new Date(n * 86400000).toISOString().slice(0, 10);

export function assertVisitWindow(windowDays) {
  if (!Array.isArray(windowDays) || windowDays.length !== 2 || !windowDays.every(Number.isInteger) || windowDays[0] < 1 || windowDays[1] < windowDays[0]) {
    fail('BAD_WINDOW', 'The visit-2 window must be [earliest, latest] whole days after visit 1, e.g. [7, 14]. There is no default.');
  }
  return true;
}

/* The earliest and latest calendar days for visit 2. */
export function visit2Window(visit1Day, windowDays) {
  assertVisitWindow(windowDays);
  const start = dayNumber(visit1Day);
  return Object.freeze({ from: isoFromDay(start + windowDays[0]), to: isoFromDay(start + windowDays[1]) });
}

/* Where one scheduled visit stands on a given day. */
export function visitStatus(visit, today) {
  const now = dayNumber(today);
  if (visit.status === 'completed') return 'completed';
  if (visit.status === 'withdrawn') return 'withdrawn';
  if (visit.status === 'missed') return 'missed';
  if (visit.from && now < dayNumber(visit.from)) return 'not_yet_due';
  if (visit.to && now > dayNumber(visit.to)) return 'overdue';
  return 'due';
}

/* Whole days between two calendar days, for de-identified exports that must not carry dates. */
export function daysBetween(fromDay, toDay) {
  return dayNumber(toDay) - dayNumber(fromDay);
}
