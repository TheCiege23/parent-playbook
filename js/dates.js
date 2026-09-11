// ===================================================================
//  PLAIN CALENDAR DATES
// ===================================================================
// Every date this app stores or compares is a plain calendar date in the USER'S own day:
// measured_on, done_on, a retention date, the max on a birthdate picker, the default on
// "when did this happen". None of them is an instant, and none of them is UTC.
//
// toISOString() is UTC, so `new Date().toISOString().slice(0,10)` is TOMORROW for a whole
// evening everywhere west of UTC, and YESTERDAY for a whole morning east of it. That was
// used in twenty-one places, and it meant:
//
//   a jump measured at 8pm in New York was stamped with tomorrow's date — a future
//   reading, which Body Insights then filters out of today's own snapshot;
//
//   the biometric consent gate compared retention_until against a UTC day, so a consent
//   valid until tonight read as expired from mid-afternoon in the Americas, while an
//   expired one kept working through the morning in Australia.
//
// This file loads before everything else so nothing has to reach across for it, and it is
// deliberately small enough that a test can load it alone.
//
// The one place UTC is correct and stays: maturity.js builds a Date from 'YYYY-MM-DDT00:00:00Z'
// and compares it back in UTC to prove the string was a real calendar date. That round trip
// is UTC on both sides, so it is asking a different question than this file answers.

/** A Date (default: now) as a plain local YYYY-MM-DD. */
function localDay(d){
  const t = d || new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

/** Today, in the user's own day. */
function todayISO(){ return localDay(); }

/** The same calendar day `months` from `d`, still local. Used for retention dates. */
function localDayMonthsFrom(months, d){
  const t = new Date(d || new Date());
  t.setMonth(t.getMonth() + months);
  return localDay(t);
}
