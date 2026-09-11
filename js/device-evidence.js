/* Device-session evidence. A side channel, deliberately.
 *
 * Every capability currently recorded at stage 0.75 rests on a sentence of the form "in the
 * user's signed-in Windows Chrome session, X happened". That is a report, not a record: the
 * assessment payload carries no user agent, no viewport and no indication of which deployed
 * build produced it, so nothing written afterwards can be checked against anything.
 *
 * This produces a small record that CAN be checked: which build served the page, what device
 * ran it, how long the work took, and how many of the defined outputs came back. It is
 * emitted ALONGSIDE an assessment and never inside one, so the scalar-only guarantees on the
 * assessment payload, its allowlist and its database CHECK constraint are untouched by it.
 *
 * It carries no measurement VALUES, no photographs, no landmarks, no geometry, no account or
 * athlete identifier, and no recorded height — only that a height was supplied. What makes a
 * device session worth recording is that the run happened on that device at that build, not
 * what the person measured.
 */
(function (root) {
  'use strict';

  const SCHEMA = 'PP_DEVICE_EVIDENCE_V1';
  const EXPECTED_OUTPUTS = 25;

  // The same vocabulary js/body-composition-contract.mjs refuses, plus the tokens that would
  // signal a measurement value or an identity had been attached to a device record.
  const FORBIDDEN = /(^|_)(photo|photos|image|images|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces|value|values|measurement|measurements|reading|readings|height_in|athlete|guardian|participant|subject|email|name)($|_)/i;

  function fail(message) { const e = Error(message); e.code = 'DEVICE_EVIDENCE_INVALID'; throw e; }

  function rejectForbidden(value, path) {
    if (Array.isArray(value)) { value.forEach((v, i) => rejectForbidden(v, path + '[' + i + ']')); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      if (FORBIDDEN.test(normalized)) fail('Device evidence cannot contain ' + path + '.' + key + '.');
      rejectForbidden(item, path + '.' + key);
    }
  }

  // Every accepted field, and nothing else. An unknown key is a mistake worth refusing rather
  // than dropping quietly: silently discarding it would let a caller believe something was
  // recorded that was not.
  const SHAPE = {
    build: { serviceWorkerCache: 'string', origin: 'string' },
    device: { userAgent: 'string', viewportWidth: 'integer', viewportHeight: 'integer', pixelRatio: 'number', standalone: 'boolean', maxTouchPoints: 'integer' },
    run: { workflowVersion: 'string', engineId: 'string', engineVersion: 'string', engineModel: 'string', processingMs: 'number', outputCount: 'integer', expectedOutputs: 'integer', missingOutputKeys: 'string[]', heightSupplied: 'boolean' },
  };

  const isInt = v => Number.isInteger(v);
  const checkers = {
    string: v => typeof v === 'string' && v.length > 0 && v.length <= 400,
    integer: v => isInt(v) && v >= 0 && v <= 1e7,
    number: v => Number.isFinite(v) && v >= 0 && v <= 1e7,
    boolean: v => typeof v === 'boolean',
    'string[]': v => Array.isArray(v) && v.length <= 64 && v.every(s => typeof s === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(s)),
  };

  function section(name, supplied) {
    const spec = SHAPE[name];
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) fail('Section ' + name + ' is required.');
    const out = {};
    for (const [key, kind] of Object.entries(spec)) {
      if (!(key in supplied)) fail('Section ' + name + ' is missing ' + key + '.');
      if (!checkers[kind](supplied[key])) fail(name + '.' + key + ' is not a valid ' + kind + '.');
      out[key] = supplied[key];
    }
    for (const key of Object.keys(supplied)) {
      if (!(key in spec)) fail('Section ' + name + ' carries an unsupported field: ' + key + '.');
    }
    return out;
  }

  function buildDeviceEvidence(input) {
    if (!input || typeof input !== 'object') fail('Device evidence input is required.');
    const recordedAt = input.recordedAt;
    if (typeof recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt))) {
      fail('recordedAt must be an ISO instant.');
    }
    for (const key of Object.keys(input)) {
      if (!['recordedAt', 'build', 'device', 'run', 'note'].includes(key)) fail('Unsupported top-level field: ' + key + '.');
    }
    const record = {
      schema: SCHEMA,
      recordedAt,
      build: section('build', input.build),
      device: section('device', input.device),
      run: section('run', input.run),
      excludes: 'No photographs, landmarks, contours, meshes, measurement values, recorded height or identifiers.',
    };
    if (input.note !== undefined) {
      if (typeof input.note !== 'string' || input.note.length > 500) fail('note must be a short string.');
      record.note = input.note;
    }
    // Belt and braces: the allowlist above should already make this unreachable, which is
    // exactly why it is worth running — a future field added to SHAPE gets checked too.
    rejectForbidden(record, 'record');
    return record;
  }

  // Collected in the page. `caches.keys()` is what makes the build claim checkable: the
  // service worker names its cache after the release, so the value cannot be typed in later
  // from memory.
  async function collectDeviceEvidence(env) {
    const g = env || root;
    const caches = g.caches, nav = g.navigator || {}, win = g;
    let serviceWorkerCache = 'unknown';
    if (caches && typeof caches.keys === 'function') {
      const names = await caches.keys();
      const match = (names || []).filter(n => /^pp-v\d+$/.test(n)).sort();
      if (match.length === 1) serviceWorkerCache = match[0];
      else if (match.length > 1) serviceWorkerCache = match[match.length - 1];
    }
    return {
      serviceWorkerCache,
      origin: (g.location && g.location.origin) || 'unknown',
      userAgent: nav.userAgent || 'unknown',
      viewportWidth: Math.round(win.innerWidth || 0),
      viewportHeight: Math.round(win.innerHeight || 0),
      pixelRatio: Number(win.devicePixelRatio || 0),
      standalone: !!((win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true),
      maxTouchPoints: Math.round(nav.maxTouchPoints || 0),
    };
  }

  // Reduce an assessment summary to the counts worth recording. The summary is NOT retained.
  function runFromSummary(summary) {
    if (!summary || typeof summary !== 'object') fail('A result summary is required.');
    const missing = Array.isArray(summary.missingOutputs) ? summary.missingOutputs.slice() : [];
    return {
      // The SDK summary calls this sdkVersion; the in-app scan has no SDK and supplies its
      // own policy version. Accept either rather than making one of them lie.
      workflowVersion: String(summary.workflowVersion || summary.sdkVersion || ''),
      engineId: String((summary.engine && summary.engine.id) || ''),
      engineVersion: String((summary.engine && summary.engine.version) || ''),
      engineModel: String((summary.engine && summary.engine.model) || ''),
      processingMs: Number(summary.processingMs || 0),
      outputCount: Number(summary.outputCount || 0),
      expectedOutputs: EXPECTED_OUTPUTS,
      missingOutputKeys: missing.map(String),
      heightSupplied: Number.isFinite(summary.height) ? summary.height > 0 : Number.isFinite(summary.heightIn) ? summary.heightIn > 0 : false,
    };
  }

  // What a reader can conclude, stated as findings rather than a single pass/fail — a device
  // session can be genuine and still be incomplete, and collapsing that to one boolean hides
  // which half failed.
  function verifyDeviceEvidence(record, options) {
    const o = options || {};
    const problems = [];
    if (!record || typeof record !== 'object') return { ok: false, problems: ['No record supplied.'] };
    if (record.schema !== SCHEMA) problems.push('Schema is ' + record.schema + ', expected ' + SCHEMA + '.');
    try { rejectForbidden(record, 'record'); } catch (e) { problems.push(e.message); }

    const b = record.build || {}, d = record.device || {}, r = record.run || {};
    if (o.expectedCache && b.serviceWorkerCache !== o.expectedCache) {
      problems.push('Build is ' + b.serviceWorkerCache + ', expected ' + o.expectedCache + '.');
    }
    if (b.serviceWorkerCache === 'unknown') problems.push('No service-worker cache was observed, so the build is unverified.');
    if (o.expectedOrigin && b.origin !== o.expectedOrigin) problems.push('Origin is ' + b.origin + ', expected ' + o.expectedOrigin + '.');

    const expected = Number.isInteger(o.expectedOutputs) ? o.expectedOutputs : EXPECTED_OUTPUTS;
    if (r.outputCount !== expected) problems.push('Returned ' + r.outputCount + ' of ' + expected + ' defined outputs.');
    if (Array.isArray(r.missingOutputKeys) && r.missingOutputKeys.length) {
      problems.push('Missing outputs: ' + r.missingOutputKeys.join(', ') + '.');
    }
    if (!r.heightSupplied) problems.push('No recorded height was supplied, so the outputs are unscaled.');

    // A phone is the point of a device session. This reports rather than refuses, because the
    // rubric distinguishes intended-desktop from intended-phone evidence and both are worth
    // recording — the reader needs to know which one they are holding.
    const touch = Number(d.maxTouchPoints || 0);
    const narrow = Number(d.viewportWidth || 0) > 0 && Number(d.viewportWidth) < 768;
    const deviceClass = touch > 0 && narrow ? 'touch-handheld' : narrow ? 'narrow-viewport' : touch > 0 ? 'touch-wide' : 'desktop';

    return { ok: problems.length === 0, problems, deviceClass, build: b.serviceWorkerCache, outputs: r.outputCount + '/' + expected };
  }

  const api = { SCHEMA, EXPECTED_OUTPUTS, buildDeviceEvidence, collectDeviceEvidence, runFromSummary, verifyDeviceEvidence };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DeviceEvidence = api;
})(globalThis);
