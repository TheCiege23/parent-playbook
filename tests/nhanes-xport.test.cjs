// Reading SAS XPORT, the only format NHANES publishes.
//
// This is the bottom of the pipeline and the one place where a mistake is completely silent. A
// misread IBM float is not an exception or an obviously wrong output — it is a plausible number of
// roughly the right magnitude, and it would travel all the way to a body-fat estimate looking like
// data. So the numeric conversion is checked against byte patterns written out BY HAND from the
// format definition, not against anything this repository produces. The encoder further down is
// used only for the container format; an encoder and a decoder that share a misunderstanding agree
// with each other perfectly, which is worth nothing.
//
// No NHANES file appears here. Every fixture is synthetic and built in memory.
const test = require('node:test');
const assert = require('node:assert/strict');

let XPORT;
test.before(async () => { XPORT = await import('../tools/nhanes/xport.mjs'); });

const bytes = (...values) => Uint8Array.from(values);

// ----------------------------------------------------------------- IBM hexadecimal floats
//
// Each pattern below is derived from the definition, independently of this repository's code:
//   value = (-1)^sign x 0.fraction x 16^(exponent - 64)
// So 1.0 is 0x10/0x100 = 0.0625 of 16^1, and its first byte is 64 + 1 = 0x41.
test('IBM floating point decodes to the values the format defines', () => {
  const cases = [
    ['1.0', [0x41, 0x10, 0, 0, 0, 0, 0, 0], 1],
    ['2.0', [0x41, 0x20, 0, 0, 0, 0, 0, 0], 2],
    ['3.0', [0x41, 0x30, 0, 0, 0, 0, 0, 0], 3],
    ['0.5', [0x40, 0x80, 0, 0, 0, 0, 0, 0], 0.5],
    ['1/16', [0x40, 0x10, 0, 0, 0, 0, 0, 0], 0.0625],
    ['16.0', [0x42, 0x10, 0, 0, 0, 0, 0, 0], 16],
    ['255.0', [0x42, 0xff, 0, 0, 0, 0, 0, 0], 255],
    ['-1.0', [0xc1, 0x10, 0, 0, 0, 0, 0, 0], -1],
    ['-0.5', [0xc0, 0x80, 0, 0, 0, 0, 0, 0], -0.5],
    ['zero', [0, 0, 0, 0, 0, 0, 0, 0], 0],
  ];
  for (const [label, pattern, expected] of cases) {
    assert.equal(XPORT.ibmToDouble(bytes(...pattern)), expected, label + ' decoded wrongly');
  }
});

test('a repeating fraction decodes to the nearest double, not to a truncation', () => {
  // 0.1 has no exact hexadecimal representation either; SAS stores 0x40 19 99 99 99 99 99 9A.
  const tenth = XPORT.ibmToDouble(bytes(0x40, 0x19, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a));
  assert.ok(Math.abs(tenth - 0.1) < 1e-15, 'expected about 0.1, got ' + tenth);
});

test('reading these bytes as IEEE 754 would give a different number, which is the whole hazard', () => {
  // The same eight bytes, both ways. If these ever agreed, the test would be proving nothing.
  const pattern = bytes(0x41, 0x10, 0, 0, 0, 0, 0, 0);
  const asIeee = new DataView(pattern.buffer.slice(0)).getFloat64(0);
  assert.equal(XPORT.ibmToDouble(pattern), 1);
  assert.notEqual(asIeee, 1);
});

test('a numeric that is not eight bytes is refused rather than padded quietly', () => {
  assert.throws(() => XPORT.ibmToDouble(bytes(0x41, 0x10)), /eight bytes/);
});

// ----------------------------------------------------------------- a synthetic XPORT file
//
// Written here rather than checked in as a binary, so the fixture is readable and no survey
// response is ever committed. Only the container layout is exercised by round-tripping; the
// numbers themselves are pinned by the hand-written patterns above.
function doubleToIbm(value) {
  const out = new Uint8Array(8);
  if (value === 0) return out;
  let v = Math.abs(value), exponent = 0;
  while (v >= 1) { v /= 16; exponent++; }
  while (v > 0 && v < 1 / 16) { v *= 16; exponent--; }
  out[0] = (exponent + 64) | (value < 0 ? 0x80 : 0);
  let fraction = v;
  for (let i = 1; i < 8; i++) { fraction *= 256; const byte = Math.floor(fraction); out[i] = byte; fraction -= byte; }
  return out;
}

const pad = (text, width) => (text + ' '.repeat(width)).slice(0, width);
const digits = (value, width) => String(value).padStart(width, '0');

function record(text) { return pad(text, 80); }

function buildXport({ member = 'TESTDATA', variables, rows, namestrSize = 140 } = {}) {
  const parts = [];
  parts.push(record('HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!' + '0'.repeat(30)));
  parts.push(record(pad('SAS', 8) + pad('SAS', 8) + pad('SASLIB', 8) + pad('9.4', 8) + pad('X64_10PRO', 8)));
  parts.push(record('12SEP26:00:00:00'));
  parts.push(record('HEADER RECORD*******MEMBER  HEADER RECORD!!!!!!!' + '0'.repeat(17) + '16' + '0'.repeat(8) + digits(namestrSize, 3)));
  parts.push(record('HEADER RECORD*******DSCRPTR HEADER RECORD!!!!!!!' + '0'.repeat(30)));
  parts.push(record(pad('SAS', 8) + pad(member, 8) + pad('SASDATA', 8) + pad('9.4', 8) + pad('X64_10PRO', 8)));
  parts.push(record('12SEP26:00:00:00'));
  parts.push(record('HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!' + '0'.repeat(6) + digits(variables.length, 4) + '0'.repeat(20)));

  // Variable descriptors, packed and then padded to a record boundary.
  let position = 0;
  const namestrs = [];
  variables.forEach((variable, index) => {
    const block = new Uint8Array(140);
    const view = new DataView(block.buffer);
    view.setInt16(0, variable.type === 'character' ? 2 : 1);
    view.setInt16(4, variable.length);
    view.setInt16(6, index + 1);
    const write = (text, at, width) => { const padded = pad(text, width); for (let i = 0; i < width; i++) block[at + i] = padded.charCodeAt(i); };
    write(variable.name, 8, 8);
    write(variable.label || '', 16, 40);
    write('', 56, 8);
    write('', 72, 8);
    view.setInt32(84, position);
    position += variable.length;
    namestrs.push(block);
  });
  const namestrBytes = Math.ceil((variables.length * 140) / 80) * 80;
  const namestrBlock = new Uint8Array(namestrBytes).fill(0x20);
  namestrs.forEach((block, i) => namestrBlock.set(block, i * 140));

  parts.push(record('HEADER RECORD*******OBS     HEADER RECORD!!!!!!!' + '0'.repeat(30)));

  const rowLength = variables.reduce((n, v) => n + v.length, 0);
  const dataLength = Math.ceil((rows.length * rowLength) / 80) * 80;
  const data = new Uint8Array(dataLength).fill(0x20);
  rows.forEach((row, r) => {
    let at = r * rowLength;
    for (const variable of variables) {
      const value = row[variable.name];
      if (variable.type === 'character') {
        const padded = pad(value == null ? '' : String(value), variable.length);
        for (let i = 0; i < variable.length; i++) data[at + i] = padded.charCodeAt(i);
      } else if (typeof value === 'string') {
        // A missing marker: one byte, then zeros.
        data[at] = value.length === 1 ? 0x2e : value.charCodeAt(1);
        for (let i = 1; i < variable.length; i++) data[at + i] = 0;
      } else {
        const ibm = doubleToIbm(value);
        for (let i = 0; i < variable.length; i++) data[at + i] = ibm[i];
      }
      at += variable.length;
    }
  });

  const head = parts.join('');
  const out = new Uint8Array(head.length + namestrBytes + dataLength);
  for (let i = 0; i < head.length - 80; i++) out[i] = head.charCodeAt(i);
  // The OBS header is the last built record and must sit after the descriptors.
  const beforeObs = head.length - 80;
  out.set(namestrBlock, beforeObs);
  for (let i = 0; i < 80; i++) out[beforeObs + namestrBytes + i] = head.charCodeAt(beforeObs + i);
  out.set(data, beforeObs + namestrBytes + 80);
  return out;
}

const DEMO = {
  member: 'DEMO',
  variables: [
    { name: 'SEQN', type: 'numeric', length: 8, label: 'Respondent sequence number' },
    { name: 'RIAGENDR', type: 'numeric', length: 8, label: 'Gender' },
    { name: 'RIDAGEYR', type: 'numeric', length: 8, label: 'Age in years at screening' },
    { name: 'SITE', type: 'character', length: 6, label: 'Synthetic site code' },
  ],
  rows: [
    { SEQN: 90001, RIAGENDR: 1, RIDAGEYR: 34, SITE: 'SYN-A' },
    { SEQN: 90002, RIAGENDR: 2, RIDAGEYR: 51, SITE: 'SYN-B' },
    { SEQN: 90003, RIAGENDR: 2, RIDAGEYR: '.', SITE: 'SYN-C' },
  ],
};

test('a synthetic export reads back its variables, labels and rows', () => {
  const parsed = XPORT.readXport(buildXport(DEMO));
  assert.equal(parsed.member, 'DEMO');
  assert.equal(parsed.variables.length, 4);
  assert.deepEqual(parsed.variables.map(v => v.name), ['SEQN', 'RIAGENDR', 'RIDAGEYR', 'SITE']);
  assert.equal(parsed.variables[0].label, 'Respondent sequence number');
  assert.equal(parsed.variables[3].type, 'character');
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].SEQN, 90001);
  assert.equal(parsed.rows[1].RIDAGEYR, 51);
});

test('character values lose their padding but keep their content', () => {
  const parsed = XPORT.readXport(buildXport(DEMO));
  assert.equal(parsed.rows[0].SITE, 'SYN-A');
  assert.ok(!parsed.rows[0].SITE.endsWith(' '));
});

test('a missing value is null, and which kind of missing it was survives', () => {
  // Returning 0 here would put an age of zero, or a body-fat percentage of zero, into a cohort.
  const parsed = XPORT.readXport(buildXport(DEMO));
  assert.equal(parsed.rows[2].RIDAGEYR, null);
  assert.equal(parsed.missing[2].RIDAGEYR, '.');
  assert.equal(parsed.missing[0].RIDAGEYR, undefined, 'a present value has no missing marker');
});

test('the survey distinguishes refused from do-not-know, and so does this reader', () => {
  const parsed = XPORT.readXport(buildXport({
    ...DEMO,
    rows: [{ SEQN: 90004, RIAGENDR: 1, RIDAGEYR: '.R', SITE: 'SYN-D' },
           { SEQN: 90005, RIAGENDR: 1, RIDAGEYR: '.D', SITE: 'SYN-E' }],
  }));
  assert.equal(parsed.missing[0].RIDAGEYR, '.R');
  assert.equal(parsed.missing[1].RIDAGEYR, '.D');
  assert.equal(parsed.rows[0].RIDAGEYR, null);
  // Collapsing these would throw away the difference between a person who declined to answer and
  // one who was never able to.
  assert.notEqual(parsed.missing[0].RIDAGEYR, parsed.missing[1].RIDAGEYR);
});

test('real-looking measurements survive the round trip', () => {
  const parsed = XPORT.readXport(buildXport({
    member: 'BMX',
    variables: [
      { name: 'SEQN', type: 'numeric', length: 8 },
      { name: 'BMXWT', type: 'numeric', length: 8, label: 'Weight (kg)' },
      { name: 'BMXHT', type: 'numeric', length: 8, label: 'Standing Height (cm)' },
      { name: 'BMXBMI', type: 'numeric', length: 8, label: 'Body Mass Index (kg/m**2)' },
    ],
    rows: [{ SEQN: 90001, BMXWT: 70.5, BMXHT: 168.3, BMXBMI: 24.9 }],
  }));
  const row = parsed.rows[0];
  for (const [key, expected] of [['BMXWT', 70.5], ['BMXHT', 168.3], ['BMXBMI', 24.9]]) {
    assert.ok(Math.abs(row[key] - expected) < 1e-9, key + ' came back as ' + row[key]);
  }
});

test('a truncated numeric is read as its leading bytes, not as a different format', () => {
  const parsed = XPORT.readXport(buildXport({
    member: 'SHORT',
    variables: [{ name: 'SEQN', type: 'numeric', length: 8 }, { name: 'VAL', type: 'numeric', length: 4 }],
    rows: [{ SEQN: 1, VAL: 2 }],
  }));
  assert.equal(parsed.rows[0].VAL, 2);
});

test('trailing padding is padding, not a phantom participant', () => {
  // The file is padded to a record boundary with spaces. Counting that as an observation would add
  // a participant who does not exist to every count in the cohort flow.
  const parsed = XPORT.readXport(buildXport(DEMO));
  assert.equal(parsed.rows.length, 3);
  assert.ok(parsed.declaredRowCapacity >= 3, 'the padded file has room for more rows than exist');
});

// ----------------------------------------------------------------- refusals
test('a file that is not XPORT is refused by name, not misread', () => {
  const notXport = new Uint8Array(800).fill(0x20);
  assert.throws(() => XPORT.readXport(notXport), error => {
    assert.equal(error.code, 'NOT_AN_XPORT_FILE');
    return true;
  });
});

test('a truncated download is refused rather than partially read', () => {
  const good = buildXport(DEMO);
  const truncated = good.slice(0, good.length - 13);
  assert.throws(() => XPORT.readXport(truncated), error => {
    assert.equal(error.code, 'TRUNCATED_XPORT_FILE');
    assert.match(error.message, /Download it again/);
    return true;
  });
});

test('an unfamiliar descriptor layout is refused instead of guessed at', () => {
  // Version 8 uses 136-byte descriptors. Reading it with the version 5 layout would produce
  // variables and numbers rather than an error, which is the worst available outcome.
  assert.throws(() => XPORT.readXport(buildXport({ ...DEMO, namestrSize: 136 })), error => {
    assert.equal(error.code, 'UNSUPPORTED_XPORT_VERSION');
    assert.match(error.message, /guessing at another layout would produce numbers rather than an error/);
    return true;
  });
});

test('a description of a file carries its shape and none of its contents', () => {
  const parsed = XPORT.readXport(buildXport(DEMO));
  const described = XPORT.describeXport(parsed);
  assert.equal(described.rowCount, 3);
  assert.equal(described.variableCount, 4);
  // An inventory is committed to the repository. A survey response must not be.
  const text = JSON.stringify(described);
  assert.ok(!text.includes('90001'), 'a participant identifier reached the description');
  assert.ok(!text.includes('SYN-A'), 'a response value reached the description');
});
