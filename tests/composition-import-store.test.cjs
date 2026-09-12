// The persistence half of imported body composition: writing records, sharing one with an
// organization, and attaching the report a transcription came from.
//
// Separated from the screen tests so this can ship inside the buyer package. The screens depend on
// application globals that do not exist there; this adapter takes a Supabase client and nothing
// else, and a buyer who is handed it should be able to run its tests rather than read them.
//
// The database is the authority for every rule here -- what a source may claim, whether a child's
// release is live, whether a reading already exists are all constraints, triggers and policies in
// supabase/migrations/. What these cover is the part a constraint cannot: turning what Postgres
// says into something a person can act on, per record, without one repeated row throwing away a
// forty-row import.
//
// Every fixture is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');

let IMPORT, STORE;
test.before(async () => {
  IMPORT = await import('../js/composition-import.mjs');
  STORE = await import('../js/composition-import-supabase.mjs');
});

const CONTEXT = Object.freeze({
  subjectId: 'synthetic-subject-001', scope: 'adult_reference',
  actorId: 'synthetic-actor-001', consentReference: 'synthetic-permission-001',
  savedAt: '2026-09-20T10:00:00.000Z', retentionUntil: '2029-09-20T10:00:00.000Z',
});
const parseCsv = (csv, source = 'smart_scale', extra = {}) =>
  IMPORT.parseCompositionCsv(csv, { ...CONTEXT, sourceClass: source, ...extra });
// ----------------------------------------------------------------- save adapter
const fakeClient = (behaviour = {}) => {
  const calls = { inserts: [], uploads: [], removals: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: behaviour.userId || '11111111-1111-4111-8111-111111111111' } } } }) },
    from(table) {
      const builder = {
        _table: table, _filters: {},
        insert(row) { calls.inserts.push({ table, row }); builder._row = row; return builder; },
        select() { return builder; },
        eq(column, value) { builder._filters[column] = value; return builder; },
        is(column) { builder._filters[column] = null; return builder; },
        gte() { return builder; }, order() { return builder; }, limit() { return builder; },
        delete() { builder._delete = true; return builder; },
        then(resolve) { return Promise.resolve(builder._result()).then(resolve); },
        maybeSingle() { return Promise.resolve(builder._result()); },
        _result() {
          if (table === 'biometric_consents') return { data: behaviour.consent === undefined ? [] : behaviour.consent };
          if (builder._row) {
            const error = behaviour.insertError?.(builder._row);
            return error ? { error } : { data: { id: '22222222-2222-4222-8222-222222222222', record_id: builder._row.record_id, verification_status: 'unverified' } };
          }
          return { data: behaviour.rows || [] };
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          upload: async (key, file, opts) => { calls.uploads.push({ key, type: opts?.contentType, size: file.size }); return behaviour.uploadError ? { error: behaviour.uploadError } : { data: { path: key } }; },
          remove: async keys => { calls.removals.push(...keys); return { data: [] }; },
        };
      },
    },
  };
  return { client, calls };
};

const oneRecord = () => IMPORT.readManualEntry(
  { measuredAt: '2026-09-10', values: { body_fat_percent: '18' } },
  { ...CONTEXT, sourceClass: 'dexa', device: { facility: 'Synthetic Clinic' } });

test('a saved reading reports as saved', async () => {
  const { client, calls } = fakeClient();
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'synthetic-subject-001' });
  const results = await store.save([oneRecord()]);
  assert.equal(results[0].outcome, 'saved');
  // The guardian comes from the session, never from the record.
  assert.equal(calls.inserts[0].row.guardian_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(calls.inserts[0].row.consent_id, null);
});

test('a reading already held is not an error', async () => {
  // Re-importing last month's export is the normal way to pick up the readings since. The rows it
  // repeats must land as "already had it", not as a wall of failures.
  const { client } = fakeClient({ insertError: () => ({ message: 'duplicate key value violates unique constraint "external_composition_reading_idx"' }) });
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'synthetic-subject-001' });
  const results = await store.save([oneRecord()]);
  assert.equal(results[0].outcome, 'already_present');
  assert.match(results[0].reason, /already have this reading/);
});

test('one repeated row does not throw away the rest of the file', async () => {
  let seen = 0;
  const { client } = fakeClient({ insertError: () => (++seen === 2 ? { message: 'duplicate key value violates unique constraint "external_composition_reading_idx"' } : null) });
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'synthetic-subject-001' });
  const records = parseCsv('Date,Weight (kg)\n2026-09-10,70\n2026-09-11,71\n2026-09-12,72\n').records;
  const results = await store.save(records);
  assert.deepEqual(results.map(r => r.outcome), ['saved', 'already_present', 'saved']);
  const summary = STORE.summarizeSave(results);
  assert.equal(summary.text, '2 readings added, 1 was already here.');
  assert.equal(summary.tone, 'ok');
});

test('a refusal is separated from a duplicate and from a success', async () => {
  const { client } = fakeClient({ insertError: () => ({ message: 'new row violates row-level security policy' }) });
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'synthetic-subject-001' });
  const summary = STORE.summarizeSave(await store.save([oneRecord()]));
  assert.equal(summary.tone, 'error');
  assert.match(summary.reasons[0], /do not have permission/);
});

test('a child import with no live release stops before writing anything', async () => {
  const { client, calls } = fakeClient({ consent: [] });
  const store = STORE.createExternalCompositionStore(client, {
    scope: 'child_athlete', athleteId: '33333333-3333-4333-8333-333333333333', subjectReference: '33333333-3333-4333-8333-333333333333' });
  await assert.rejects(() => store.save([oneRecord()]), error => {
    assert.equal(error.code, 'NO_LIVE_CONSENT');
    assert.match(error.message, /Record one before importing/);
    return true;
  });
  assert.equal(calls.inserts.length, 0, 'nothing should have been attempted');
});

test('a child import under a live release carries that release on every row', async () => {
  const { client, calls } = fakeClient({ consent: [{ id: '44444444-4444-4444-8444-444444444444', retention_until: '2099-01-01' }] });
  const store = STORE.createExternalCompositionStore(client, {
    scope: 'child_athlete', athleteId: '33333333-3333-4333-8333-333333333333', subjectReference: '33333333-3333-4333-8333-333333333333' });
  await store.save(parseCsv('Date,Weight (kg)\n2026-09-10,70\n2026-09-11,71\n').records);
  assert.equal(calls.inserts.length, 2);
  for (const call of calls.inserts) assert.equal(call.row.consent_id, '44444444-4444-4444-8444-444444444444');
});

test('an adult reference cannot be imported under a child release', async () => {
  const { client } = fakeClient();
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'me' });
  await assert.rejects(() => store.save([oneRecord()], { consentId: '44444444-4444-4444-8444-444444444444' }), /not imported under a child release/);
});

test('a child subject reference that is not the athlete id is refused at construction', () => {
  const { client } = fakeClient();
  assert.throws(() => STORE.createExternalCompositionStore(client, {
    scope: 'child_athlete', athleteId: '33333333-3333-4333-8333-333333333333', subjectReference: '55555555-5555-4555-8555-555555555555' }),
    /subject reference is that athlete/);
});

// ----------------------------------------------------------------- attachments
test('a report is stored under the record, and its filename is not kept', async () => {
  const { client, calls } = fakeClient();
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'me' });
  const saved = await store.attachReport('22222222-2222-4222-8222-222222222222',
    { type: 'application/pdf', size: 1024, name: 'Jane Doe DXA results.pdf' });
  // The file people hand over is routinely named after the patient.
  assert.equal(saved.storageKey, '22222222-2222-4222-8222-222222222222/report.pdf');
  assert.ok(!calls.uploads[0].key.includes('Jane'));
  assert.equal(saved.verification, 'unverified');
});

test('an unsupported or oversized file is refused before anything is uploaded', async () => {
  const { client, calls } = fakeClient();
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'me' });
  await assert.rejects(() => store.attachReport('22222222-2222-4222-8222-222222222222', { type: 'application/zip', size: 10 }), /can be a PDF/);
  await assert.rejects(() => store.attachReport('22222222-2222-4222-8222-222222222222', { type: 'application/pdf', size: 21 * 1024 * 1024 }), /larger than 20 MB/);
  assert.equal(calls.uploads.length, 0);
});

test('an upload whose row cannot be written is taken back out again', async () => {
  // An object with no row is an orphan: nothing references it, nothing sweeps it, and it is
  // somebody's clinical document.
  const { client, calls } = fakeClient({ insertError: () => ({ message: 'permission denied' }) });
  const store = STORE.createExternalCompositionStore(client, { scope: 'adult_reference', subjectReference: 'me' });
  await assert.rejects(() => store.attachReport('22222222-2222-4222-8222-222222222222', { type: 'application/pdf', size: 1024 }), /removed again/);
  assert.deepEqual(calls.removals, ['22222222-2222-4222-8222-222222222222/report.pdf']);
});

// ----------------------------------------------------------------- the store
const sharingClient = (behaviour = {}) => {
  const calls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: '11111111-1111-4111-8111-111111111111' } } } }) },
    from(table) {
      const b = { _f: {},
        update(patch) { b._patch = patch; return b; },
        select() { return b; }, eq(c, v) { b._f[c] = v; return b; }, is(c) { b._f[c] = null; return b; },
        order() { return b; }, limit() { return b; }, delete() { return b; },
        then(resolve) { return Promise.resolve(b._result()).then(resolve); },
        maybeSingle() { return Promise.resolve(b._result()); },
        _result() {
          if (b._patch) { calls.push({ table, patch: b._patch, filters: { ...b._f } });
            return behaviour.updateError ? { error: behaviour.updateError } : { data: behaviour.updated ?? [{ id: b._f.id, team_id: b._patch.team_id }] }; }
          return { data: [] };
        } };
      return b;
    },
  };
  return { client, calls };
};

const TEAM = '99999999-9999-4999-8999-999999999999';
const ATHLETE = '33333333-3333-4333-8333-333333333333';
const READING = '22222222-2222-4222-8222-222222222222';
const store = client => STORE.createExternalCompositionStore(client, { scope: 'child_athlete', athleteId: ATHLETE, subjectReference: ATHLETE });

test('sharing sets the team on the row, scoped to this athlete', async () => {
  const { client, calls } = sharingClient();
  assert.equal(await store(client).share(READING, TEAM), true);
  assert.deepEqual(calls[0].patch, { team_id: TEAM });
  // Scoped, so a row id from another family cannot be shared into this team by guessing it.
  assert.equal(calls[0].filters.athlete_id, ATHLETE);
  assert.equal(calls[0].filters.subject_scope, 'child_athlete');
  assert.equal(calls[0].filters.id, READING);
});

test('stopping sharing clears it', async () => {
  const { client, calls } = sharingClient();
  assert.equal(await store(client).unshare(READING), true);
  assert.deepEqual(calls[0].patch, { team_id: null });
});

test('a share that matched no row is an error, not a silent success', async () => {
  // Row-level security turns "not yours" into "no rows updated". Reporting that as success would
  // tell a parent their reading is shared when it is not.
  const { client } = sharingClient({ updated: [] });
  await assert.rejects(() => store(client).share(READING, TEAM), error => {
    assert.equal(error.code, 'SHARE_FAILED');
    assert.match(error.message, /may not be yours to share/);
    return true;
  });
});

test('a malformed team id never reaches the database', async () => {
  const { client, calls } = sharingClient();
  await assert.rejects(() => store(client).share(READING, 'not-a-uuid'), /teamId must be a UUID/);
  assert.equal(calls.length, 0);
});

test('the family list reports whether each reading is shared', async () => {
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: '11111111-1111-4111-8111-111111111111' } } } }) },
    from() {
      const b = { select() { return b; }, eq() { return b; }, is() { return b; }, order() { return b; },
        limit: () => Promise.resolve({ data: [
          { id: 'a', record_id: 'r1', measured_at: '2026-09-10T12:00:00.000Z', source_class: 'dexa', team_id: TEAM, record: { outputs: [] } },
          { id: 'b', record_id: 'r2', measured_at: '2026-09-09T12:00:00.000Z', source_class: 'smart_scale', team_id: null, record: { outputs: [] } }] }) };
      return b;
    },
  };
  const rows = await store(client).list();
  assert.deepEqual(rows.map(r => r.sharedWithTeamId), [TEAM, null]);
});
