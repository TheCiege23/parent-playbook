/* Participant codes and export pseudonyms for the measurement study.
 *
 * A participant code is what every study record carries instead of a name. The link between a code
 * and a person lives in a separate file (see store.mjs) that only the study coordinator opens, so a
 * measurement file that leaks identifies nobody on its own.
 *
 * Format: PPS-XXXXXX-C
 *   six characters from Crockford's base-32 alphabet, which leaves out I, L, O and U so a code read
 *   aloud or handwritten is hard to garble, plus one check character.
 *
 * The check character uses odd weights modulo 32, so any single mistyped character is detected.
 * A swap of two adjacent characters is detected unless their values differ by exactly 16. That
 * limitation is stated here rather than discovered on a clipboard.
 *
 * Export pseudonyms are a keyed hash of the code. An export can be shared with an analyst who never
 * sees participant codes, and two exports made with different keys cannot be joined to each other.
 */

import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const WEIGHTS = [1, 3, 5, 7, 9, 11];
const CODE = /^PPS-([0-9A-HJKMNP-TV-Z]{6})-([0-9A-HJKMNP-TV-Z])$/;

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyCodeError', code }); };

function checkCharacter(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += WEIGHTS[i] * ALPHABET.indexOf(body[i]);
  return ALPHABET[sum % 32];
}

/* Crockford normalisation: case-insensitive, and the look-alikes O, I and L read as 0, 1 and 1. */
export function normalizeParticipantCode(input) {
  return String(input ?? '').trim().toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function isValidParticipantCode(input) {
  const match = normalizeParticipantCode(input).match(CODE);
  return !!match && checkCharacter(match[1]) === match[2];
}

/* A new code not already in use. randomBytes is injectable so tests are deterministic. */
export function newParticipantCode(existing = new Set(), randomBytes = crypto.randomBytes) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const bytes = randomBytes(6);
    const body = Array.from(bytes, b => ALPHABET[b % 32]).join('');
    const code = 'PPS-' + body + '-' + checkCharacter(body);
    if (!existing.has(code)) return code;
  }
  fail('CODE_SPACE_EXHAUSTED', 'Could not find an unused participant code in 1000 attempts.');
}

/* A pseudonym for one export, derived from the code and a key the export never contains. */
export function exportPseudonym(participantCode, exportKey) {
  if (!isValidParticipantCode(participantCode)) fail('INVALID_CODE', 'Not a valid participant code: ' + participantCode);
  if (typeof exportKey !== 'string' || exportKey.length < 32) {
    fail('WEAK_EXPORT_KEY', 'An export key must be at least 32 characters. A short key makes the pseudonyms guessable from the codes.');
  }
  const digest = crypto.createHmac('sha256', exportKey).update(normalizeParticipantCode(participantCode)).digest();
  return 'S-' + Array.from(digest.subarray(0, 8), b => ALPHABET[b % 32]).join('');
}
