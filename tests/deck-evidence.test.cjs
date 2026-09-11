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
  assert.strictEqual(weighted, 37.75, 'rubric total changed; the deck and this test both need review');
  assert.ok(deck.includes('37.75%'), 'the deck should state the weighted score');
  assert.ok(deck.includes('38% rounded'), 'the deck should state the rounded score');
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
