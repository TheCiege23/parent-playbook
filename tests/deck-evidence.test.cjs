// The deck goes stale silently. That is the failure mode worth a test.
//
// A slide that says pp-v85 after the build moved to pp-v87 is not caught by any
// suite, because nothing executes a slide. It is caught in the meeting, by the
// buyer, which is the most expensive place to find it. So every number the deck
// asserts about this repository is checked here against the thing that produces
// it, and a version bump that leaves the deck behind fails the suite instead.
//
// This checks internal consistency only. It cannot know whether pp-v87 is
// actually deployed — that is what tools/deployment-smoke.cjs is for.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

// The source and the rendered deck both state the numbers, so both are checked.
// Keeping them in one string means a claim only has to be wrong in one of them
// to fail, which is the behaviour worth having.
const source = read('FRIDAY-DECK.md');
const rendered = read('friday-deck.html');
const deck = source + '\n' + rendered;
const { EXPECTED_CACHE } = require('../tools/deployment-smoke.cjs');
const { BUNDLE_FILES } = require('../tools/sdk-files.cjs');
const parity = require('../tools/parity-progress.json');

// The weighted total the deck is allowed to state, recomputed from the rubric
// rather than copied from the file's own summary.
const weighted = parity.categories.reduce((sum, c) => sum + c.stage * c.weight, 0);

test('the deck cites the service-worker version the smoke check expects', () => {
  const cited = [...deck.matchAll(/pp-v(\d+)/g)].map(m => m[0]);
  assert.ok(cited.length > 0, 'the deck should name the build it was written against');
  for (const version of new Set(cited)) {
    assert.strictEqual(version, EXPECTED_CACHE,
      `the deck cites ${version} but deployment-smoke.cjs expects ${EXPECTED_CACHE}`);
  }
});

test('the deck cites the weighted parity score the rubric produces', () => {
  assert.strictEqual(weighted, 42.75, 'rubric total changed; the deck and this test both need review');
  assert.ok(deck.includes('42.75%'), 'the deck should state the weighted score');
  assert.ok(deck.includes('43% rounded'), 'the deck should state the rounded score');
  // A deck that quietly claims a category is accepted is the failure this guards.
  const accepted = parity.categories.filter(c => c.stage === 1).length;
  assert.strictEqual(accepted, 0);
  assert.ok(/[Zz]ero of thirteen categories are fully accepted/.test(deck),
    'the deck must keep saying no category is fully accepted while that is true');
});

test('the deck cites the archive size the bundler actually produces', () => {
  const payload = BUNDLE_FILES.length;
  assert.ok(deck.includes(`${payload} files`) || deck.includes(`${payload}/${payload}`),
    `the deck should reflect ${payload} payload files`);
});

test('the deck and the SDK guide agree on which archive is current', () => {
  const guide = read('BODY-SDK.md');
  const readiness = read('FRIDAY-DEMO-READINESS.md');
  const snapshot = /parent-playbook-sdk-[\w.-]+\.zip/;
  const inGuide = guide.match(snapshot);
  const inReadiness = readiness.match(snapshot);
  assert.ok(inGuide && inReadiness, 'both documents should name the current archive');
  assert.strictEqual(inGuide[0], inReadiness[0],
    'BODY-SDK.md and FRIDAY-DEMO-READINESS.md name different archives');

  // The recorded checksum must be one value, in both places, or a buyer checking a
  // transferred package cannot tell which document to believe. Read it from the
  // snapshot line rather than the first 64 hex characters in the file — both
  // documents also record checksums of other artifacts.
  const snapshotLine = text => text.match(/^The current buyer (handoff snapshot|SDK handoff) is .*$/m);
  const hashOn = line => (line && line[0].match(/\b[0-9A-F]{64}\b/) || [])[0];
  const guideHash = hashOn(snapshotLine(guide));
  const readinessHash = hashOn(snapshotLine(readiness));
  assert.ok(guideHash, 'BODY-SDK.md should record the archive checksum on its snapshot line');
  assert.strictEqual(guideHash, readinessHash,
    'the two documents record different checksums for the same archive');

  // And the file count stated beside the hash must match the bundler.
  const stated = guide.match(/(\d+) verified payload files/);
  assert.ok(stated, 'BODY-SDK.md should state the payload file count');
  assert.strictEqual(Number(stated[1]), BUNDLE_FILES.length);
});

test('the deck keeps the claims we are not allowed to make out of it', () => {
  // These are not style preferences. Each one is a claim we have no evidence for,
  // and a slide is exactly where one would get made by accident.
  //
  // Each pattern matches the AFFIRMATIVE form only. The deck says "not validated
  // anatomical girths" and "no claim of DEXA equivalence" on purpose, and a guard
  // that fires on a disclaimer would push the disclaimers off the slide — the
  // opposite of what this test is for.
  const forbidden = [
    /\bis DEXA[- ]equivalent/i,
    /\b(is|are) clinically valid/i,
    /\b(are|provides?|delivers?) validated (anatomical )?(girths?|circumferences?)/i,
    /\b(is|are) equivalent to FIT:?MATCH/i,
    /\bmatch(es)? FIT:?MATCH accuracy/i,
  ];
  // A pattern that cannot match anything would pass this test forever while
  // catching nothing, so each one is first shown to fire on a sentence that does
  // make the claim. Tightening a pattern until it stops matching the deck is a
  // real risk here; this is what stops it.
  const control = [
    'This output is DEXA-equivalent to a clinical scan.',
    'The maturity estimate is clinically valid for screening.',
    'The scan provides validated anatomical girths at three planes.',
    'Our anthropometrics are equivalent to FITMATCH results.',
    'Independent testing shows we match FIT:MATCH accuracy.',
  ];
  forbidden.forEach((pattern, i) => {
    assert.ok(pattern.test(control[i]), `pattern ${pattern} no longer detects the claim it guards`);
    assert.ok(!pattern.test(deck), `the deck must not claim: ${pattern}`);
  });
  // And it must keep saying what is absent.
  assert.ok(/Model not configured/.test(deck), 'the deck should state the composition gate is unconfigured');
});

test('the rendered deck is not in the deployment allowlist', () => {
  // It carries speaker notes naming our weakest categories and the defects found
  // during the build. Shipping it to the public origin would be a disclosure, and
  // the Dockerfile allowlist is the only thing preventing it.
  const dockerfile = read('Dockerfile');
  assert.ok(!dockerfile.includes('friday-deck.html'),
    'friday-deck.html must stay out of the Dockerfile COPY allowlist');
  assert.ok(dockerfile.includes('friday-demo.html'),
    'the demo room is expected to be deployed; if this changed, re-check what else the allowlist now covers');
});

test('the source deck and the rendered deck tell the same story', () => {
  // Not a diff — the rendered deck is edited for a screen. But a slide heading that
  // exists in one and not the other means somebody updated a single copy.
  for (const heading of ['Capability against FIT:MATCH', 'The live sequence',
    'Where this goes, and what it needs']) {
    assert.ok(source.includes(heading), `FRIDAY-DECK.md lost the slide: ${heading}`);
    assert.ok(rendered.includes(heading), `friday-deck.html lost the slide: ${heading}`);
  }
});

test('the deck cites the JavaScript suite size the repository actually has', () => {
  // I previously called this unenforceable — "the one number the guard can't check without
  // running the suite it belongs to" — and let it go stale three times in a row: 276, then
  // 283, then 289 against a suite that had grown past all of them. It is enforceable. Every
  // test in this repository is a top-level `test(` call, so the count is derivable by
  // reading the files, and the static total matches `node --test` exactly.
  //
  // If tests ever start being generated inside a loop, this will under-count and fail. That
  // is the right failure: it means the number on the slide can no longer be derived this way
  // and the deck needs a different source for it, not that the deck is wrong.
  const dir = path.join(root, 'tests');
  const declared = fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.cjs'))
    .reduce((n, f) => n + (fs.readFileSync(path.join(dir, f), 'utf8').match(/^\s*test\(/gm) || []).length, 0);
  assert.ok(declared > 0, 'no test declarations found; the counting assumption has broken');
  assert.ok(deck.includes(`${declared}/${declared}`),
    `the deck should cite ${declared}/${declared} for the JavaScript suite; it grew without the deck being updated`);
});

test('the recorded archive still describes the payload that would be built today', () => {
  // The gap this closes. The published SHA-256 is of the ZIP, and a ZIP is not
  // byte-reproducible — Compress-Archive stamps timestamps, so zipping identical files twice
  // gives two different hashes. That checksum proves a received archive is intact; it cannot
  // say whether the payload has moved on since it was recorded. Nothing did, and the v10
  // record went stale when three bundled tools changed under it.
  //
  // bundleDigest() hashes every shipped path and its contents through the real bundler, so
  // this fails the moment a bundled file changes without the archive being rebuilt and its
  // record updated.
  const { bundleDigest } = require('../tools/sdk-bundle.cjs');
  const guide = read('BODY-SDK.md');
  const recorded = (guide.match(/payload digest `([0-9a-f]{64})`/) || [])[1];
  assert.ok(recorded, 'BODY-SDK.md should record the payload digest beside the archive checksum');
  assert.strictEqual(bundleDigest(), recorded,
    'a bundled file changed since the archive was recorded: rebuild the archive, re-run ' +
    'tools/acceptance.cjs against the extracted copy, and update the recorded checksum and digest');
});

// The JavaScript suite size is checked above by counting declarations. The DATABASE total
// cannot be derived the same way — tests/db/security-tests.cjs makes 110 add() calls that
// expand into 159 cases — so the number on the slide is measured by running the suite, and
// nothing was checking that the four documents quoting it agreed.
//
// They stopped agreeing. CLAUDE-CONTINUATION-HANDOFF.md said 154/154 while the deck, the
// SDK guide and the handoff's own SDK paragraph all said 204/204. A buyer reading two of
// our documents would have found two different numbers for the same command.
//
// This cannot verify the total is right; only running tests/db/run.cjs does that. It can
// verify that one number was updated everywhere, which is the failure that actually
// happened.
const DB_TOTAL = 204;
const DB_SECURITY = 187;
const DB_RESTORE = 17;

test('every document quotes the same database total', () => {
  const sites = [
    ['CLAUDE-CONTINUATION-HANDOFF.md', /Executable database tests: \*\*(\d+)\/(\d+) passing\*\*/, 'the handoff summary line'],
    ['CLAUDE-CONTINUATION-HANDOFF.md', /database (\d+)\/(\d+), host serving/, "the handoff's acceptance paragraph"],
    ['FRIDAY-DECK.md', /\| Database suite \|[^|]*\| (\d+)\/(\d+) on a disposable cluster/, 'the deck evidence table'],
    ['FRIDAY-DECK.md', /database (\d+)\/(\d+), host serving/, "the deck's buyer-package row"],
    ['friday-deck.html', /<td>Database suite<\/td><td><code>node tests\/db\/run\.cjs<\/code><\/td><td>(\d+)\/(\d+)<\/td>/, 'the rendered deck'],
    ['BODY-SDK.md', /(\d+)\/(\d+) database cases/, 'the SDK guide'],
  ];
  const disagreements = [];
  for (const [file, pattern, where] of sites) {
    const m = fs.readFileSync(path.join(root, file), 'utf8').match(pattern);
    if (!m) { disagreements.push(where + ' (' + file + '): no database total found at all'); continue; }
    if (m[1] !== m[2]) disagreements.push(where + ': ' + m[1] + '/' + m[2] + ' is not a clean pass');
    if (Number(m[1]) !== DB_TOTAL) disagreements.push(where + ': says ' + m[1] + ', expected ' + DB_TOTAL);
  }
  assert.deepEqual(disagreements, [],
    'one number was changed and the others were not. Run node tests/db/run.cjs, then update '
    + 'DB_TOTAL here and every site listed above together.');
});

test('the two halves of that total are quoted consistently too', () => {
  assert.equal(DB_SECURITY + DB_RESTORE, DB_TOTAL,
    'the split stated in the prose has to add up to the total stated beside it');
  for (const file of ['CLAUDE-CONTINUATION-HANDOFF.md', 'FRIDAY-DECK.md', 'BODY-SDK.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(text, new RegExp(DB_SECURITY + ' security'),
      file + ' should name the security half of the total');
    assert.match(text, new RegExp(DB_RESTORE + '-case restore'),
      file + ' should name the restore-and-deletion half');
  }
});

test('the restore rehearsal really does declare that many cases', () => {
  // This half IS derivable — every case is a top-level check() call — so it is checked
  // rather than trusted. The security half is not: its cases expand out of a loop, which is
  // why the total above has to come from a run.
  const text = fs.readFileSync(path.join(root, 'tests', 'db', 'restore-deletion.cjs'), 'utf8');
  const declared = (text.match(/^\s*check\(/gm) || []).length;
  assert.equal(declared, DB_RESTORE,
    'the rehearsal declares ' + declared + ' cases; the documents say ' + DB_RESTORE);
});
