/* Reading SAS XPORT version 5 files, which is the only format NHANES publishes.
 *
 * This is the bottom of the pipeline: every number in every later stage comes through here, and a
 * mistake here is invisible. There is no exception, no parse failure and no obviously wrong output
 * — a misread IBM float is a plausible number of roughly the right magnitude, and it would travel
 * all the way to a body-fat estimate looking like data.
 *
 * THE PART THAT IS EASY TO GET WRONG
 *
 * SAS numerics are IBM System/360 hexadecimal floating point, not IEEE 754. Same eight bytes, a
 * different meaning:
 *
 *   sign     1 bit
 *   exponent 7 bits, excess-64, and in base SIXTEEN rather than base two
 *   fraction 56 bits, interpreted as 0.fffff... in hexadecimal
 *
 *   value = (-1)^sign x 0.fraction x 16^(exponent - 64)
 *
 * Reading these bytes with a DataView getFloat64 returns a number. It is simply the wrong one, and
 * nothing downstream can tell. The conversion below is tested against byte patterns written out by
 * hand from the format definition rather than produced by this file's own encoder, because an
 * encoder and a decoder that share a misunderstanding agree with each other perfectly.
 *
 * MISSING IS NOT ZERO
 *
 * SAS distinguishes a value that is absent from a value that is zero, and has twenty-eight ways to
 * say absent (., ._, .A through .Z). NHANES uses them. Returning 0 for any of them would put a
 * body-fat percentage of zero into a training set, so they come back as null with the specific
 * marker preserved — a survey that says .R for "refused" and .D for "don't know" is telling you
 * two different things about a person.
 */

const RECORD = 80;
const NAMESTR = 140;                       // XPORT v5; v8 uses 136 and is not what NHANES ships

const LIBRARY_HEADER = 'HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!';
const MEMBER_HEADER = 'HEADER RECORD*******MEMBER  HEADER RECORD!!!!!!!';
const DSCRPTR_HEADER = 'HEADER RECORD*******DSCRPTR HEADER RECORD!!!!!!!';
const NAMESTR_HEADER = 'HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!';
const OBS_HEADER = 'HEADER RECORD*******OBS     HEADER RECORD!!!!!!!';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'XportError', code }); };

const ascii = (bytes, start, length) => {
  let out = '';
  for (let i = start; i < start + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
};
// SAS pads with spaces, never with NUL. Trailing spaces are padding and carry no meaning; leading
// ones would, so only the tail is trimmed.
const trimPad = text => text.replace(/ +$/, '');

/* The twenty-eight ways SAS says "no value here".
 *
 * A missing numeric is one marker byte followed by zeros. The marker distinguishes them, and the
 * distinction is real survey information — NHANES uses separate markers for refused and don't
 * know, and collapsing those into one null throws away the difference between a person who
 * declined and a person who was never asked.
 */
function missingMarker(bytes) {
  for (let i = 1; i < bytes.length; i++) if (bytes[i] !== 0) return null;
  const first = bytes[0];
  if (first === 0x2e) return '.';                                   // standard missing
  if (first === 0x5f) return '._';                                  // underscore missing
  if (first >= 0x41 && first <= 0x5a) return '.' + String.fromCharCode(first); // .A through .Z
  return null;
}

/* IBM hexadecimal floating point to the nearest double.
 *
 * The fraction is accumulated from the least significant byte upward. Building it as an integer
 * and dividing by 2^56 at the end would lose the low bits of a full 56-bit fraction, because that
 * integer exceeds what a double represents exactly — the error is small, silent, and in the last
 * digits of every measurement in the file.
 */
export function ibmToDouble(bytes) {
  if (bytes.length !== 8) fail('BAD_NUMERIC_WIDTH', 'An IBM double is eight bytes; got ' + bytes.length + '.');
  let allZero = true;
  for (const byte of bytes) if (byte !== 0) { allZero = false; break; }
  if (allZero) return 0;

  const sign = (bytes[0] & 0x80) ? -1 : 1;
  const exponent = (bytes[0] & 0x7f) - 64;
  let fraction = 0;
  for (let i = 7; i >= 1; i--) fraction = (fraction + bytes[i]) / 256;
  return sign * fraction * Math.pow(16, exponent);
}

/* One stored numeric field.
 *
 * SAS may store a numeric in fewer than eight bytes by dropping trailing fraction bytes, so a
 * short field is right-padded with zeros back to eight rather than being a different format.
 */
function readNumeric(bytes, offset, length) {
  const full = new Uint8Array(8);
  for (let i = 0; i < length && i < 8; i++) full[i] = bytes[offset + i];
  const marker = missingMarker(full);
  if (marker) return { value: null, missing: marker };
  return { value: ibmToDouble(full), missing: null };
}

const int16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
const int32 = (bytes, offset) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

function expectHeader(bytes, offset, expected, what) {
  const found = ascii(bytes, offset, expected.length);
  if (found !== expected) {
    fail('NOT_AN_XPORT_FILE', 'Expected the ' + what + ' record at byte ' + offset
      + '. This is not a SAS XPORT version 5 file, or it has been altered in transit — check the download rather than working around this.');
  }
}

function readNamestr(bytes, offset) {
  const type = int16(bytes, offset);
  if (type !== 1 && type !== 2) fail('UNKNOWN_VARIABLE_TYPE', 'Variable type ' + type + ' is neither numeric nor character.');
  return {
    type: type === 1 ? 'numeric' : 'character',
    length: int16(bytes, offset + 4),
    order: int16(bytes, offset + 6),
    name: trimPad(ascii(bytes, offset + 8, 8)),
    label: trimPad(ascii(bytes, offset + 16, 40)),
    format: trimPad(ascii(bytes, offset + 56, 8)),
    informat: trimPad(ascii(bytes, offset + 72, 8)),
    position: int32(bytes, offset + 84),
  };
}

/* Read an XPORT file into variables and rows.
 *
 * Rows come back as plain objects keyed by variable name, with `null` for every missing value and
 * a parallel record of which marker produced it. Nothing is coerced, defaulted or dropped: a
 * reader that quietly discards a malformed row is a reader that changes the cohort without
 * telling anyone.
 */
export function readXport(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < RECORD * 6) fail('NOT_AN_XPORT_FILE', 'This file is too short to be an XPORT file.');
  if (bytes.length % RECORD !== 0) {
    fail('TRUNCATED_XPORT_FILE', 'An XPORT file is a whole number of 80-byte records; this one is '
      + (bytes.length % RECORD) + ' bytes past the last complete record, so it is truncated. Download it again.');
  }

  expectHeader(bytes, 0, LIBRARY_HEADER, 'library header');
  expectHeader(bytes, RECORD * 3, MEMBER_HEADER, 'member header');
  expectHeader(bytes, RECORD * 4, DSCRPTR_HEADER, 'descriptor header');

  // The member header names the namestr size; NHANES is always 140, and a different value means
  // this is a version this reader has not been shown to handle rather than one it should guess at.
  const namestrSize = Number(ascii(bytes, RECORD * 3 + 75, 3).trim() || NAMESTR);
  if (namestrSize !== NAMESTR) {
    fail('UNSUPPORTED_XPORT_VERSION', 'This file uses ' + namestrSize + '-byte variable descriptors. '
      + 'This reader handles the 140-byte version 5 layout that NHANES publishes, and guessing at another layout would produce numbers rather than an error.');
  }

  const memberName = trimPad(ascii(bytes, RECORD * 5 + 8, 8));
  const namestrHeaderAt = RECORD * 7;
  expectHeader(bytes, namestrHeaderAt, NAMESTR_HEADER, 'variable descriptor header');
  const variableCount = Number(ascii(bytes, namestrHeaderAt + 54, 4));
  if (!Number.isInteger(variableCount) || variableCount <= 0) fail('NOT_AN_XPORT_FILE', 'The file declares no variables.');

  const variables = [];
  for (let i = 0; i < variableCount; i++) variables.push(readNamestr(bytes, namestrHeaderAt + RECORD + i * NAMESTR));

  // Namestr records are padded to a whole number of 80-byte records before the observation header.
  const namestrBytes = Math.ceil((variableCount * NAMESTR) / RECORD) * RECORD;
  const obsHeaderAt = namestrHeaderAt + RECORD + namestrBytes;
  expectHeader(bytes, obsHeaderAt, OBS_HEADER, 'observation header');

  const rowLength = variables.reduce((sum, v) => sum + v.length, 0);
  if (rowLength <= 0) fail('NOT_AN_XPORT_FILE', 'The declared variables have no length.');

  const dataStart = obsHeaderAt + RECORD;
  const dataBytes = bytes.length - dataStart;
  const rows = [], missing = [];
  for (let offset = dataStart; offset + rowLength <= bytes.length; offset += rowLength) {
    // The file is padded to a record boundary with spaces. A final partial row of padding is
    // padding, not an observation, and counting it would add a phantom participant.
    let allPadding = true;
    for (let i = 0; i < rowLength; i++) if (bytes[offset + i] !== 0x20) { allPadding = false; break; }
    if (allPadding) break;

    const row = {}, rowMissing = {};
    for (const variable of variables) {
      const at = offset + variable.position;
      if (variable.type === 'character') {
        row[variable.name] = trimPad(ascii(bytes, at, variable.length));
      } else {
        const read = readNumeric(bytes, at, variable.length);
        row[variable.name] = read.value;
        if (read.missing) rowMissing[variable.name] = read.missing;
      }
    }
    rows.push(row);
    missing.push(rowMissing);
  }

  return Object.freeze({
    member: memberName,
    variables: Object.freeze(variables.map(Object.freeze)),
    rows,
    // Parallel to `rows`. Kept separate so a row is a plain record of values, while the reason a
    // value is absent stays available to the cohort report that has to account for it.
    missing,
    rowLength,
    declaredRowCapacity: Math.floor(dataBytes / rowLength),
  });
}

/* A short description of what a file contains, for the inventory.
 *
 * Deliberately does not include any observation. An inventory is a list of what was downloaded and
 * what shape it has; a survey response does not belong in a file that gets committed.
 */
export function describeXport(parsed) {
  return Object.freeze({
    member: parsed.member,
    variableCount: parsed.variables.length,
    rowCount: parsed.rows.length,
    rowLength: parsed.rowLength,
    variables: Object.freeze(parsed.variables.map(v => Object.freeze({
      name: v.name, type: v.type, length: v.length, label: v.label,
    }))),
  });
}
