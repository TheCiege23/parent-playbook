// delete-account is how a parent erases their own account, and with it their children's data. It had
// no test, because it could only run in the edge runtime. The cases that matter are the ones a mistake
// would make irreversible:
//   - a sole guardian's household and files must go, and the login last;
//   - a co-parent's leaving must NOT delete children another guardian still parents;
//   - the login is not deleted while references to it would make the delete fail half-way.
// The logic now lives in handler.mjs. These tests run it against an in-memory stand-in for Supabase
// that records every write, so order and scope are checked rather than assumed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dir = path.join(__dirname, '../supabase/functions/delete-account');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);

function fakeSupabase({ tables = {}, folders = {}, user = 'u', deleteUserError = null, familyDeleteError = null } = {}) {
  const events = [];
  const service = {
    from(table) {
      const state = { op: 'select', patch: null, filters: [], order: null };
      const rows = () => (tables[table] ||= []);
      const matches = row => state.filters.every(([kind, column, value]) => kind === 'eq' ? row[column] === value : value.includes(row[column]));
      const where = () => state.filters.map(([kind, column, value]) => kind === 'eq' ? column + '=' + value : column + ' in [' + value.join(',') + ']').join(' & ');
      const execute = () => {
        const matched = rows().filter(matches);
        if (state.op === 'select') {
          const data = state.order ? [...matched].sort((a, b) => String(a[state.order]).localeCompare(String(b[state.order]))) : matched;
          return { data: data.map(row => ({ ...row })), error: null };
        }
        if (state.op === 'update') {
          for (const row of matched) Object.assign(row, state.patch);
          events.push(['update', table, JSON.stringify(state.patch), where()]);
          return { error: null };
        }
        if (table === 'families' && familyDeleteError) { events.push(['delete refused', table, where()]); return { error: familyDeleteError }; }
        tables[table] = rows().filter(row => !matches(row));
        events.push(['delete', table, where()]);
        return { error: null };
      };
      const builder = {
        select() { state.op = 'select'; return builder; },
        update(patch) { state.op = 'update'; state.patch = patch; return builder; },
        delete() { state.op = 'delete'; return builder; },
        eq(column, value) { state.filters.push(['eq', column, value]); return builder; },
        in(column, values) { state.filters.push(['in', column, values]); return builder; },
        order(column) { state.order = column; return builder; },
        then(resolve, reject) { try { resolve(execute()); } catch (error) { reject(error); } },
      };
      return builder;
    },
    storage: {
      from: bucket => ({
        list: async (folder, { limit, offset }) => {
          const names = (folders[bucket] || {})[folder] || [];
          return { data: names.slice(offset, offset + limit).map(name => ({ name })), error: null };
        },
        remove: async paths => { events.push(['remove', bucket, [...paths].sort()]); return { error: null }; },
      }),
    },
    auth: { admin: { deleteUser: async id => { events.push(['deleteUser', id]); return { error: deleteUserError }; } } },
  };
  const callerClient = () => ({ auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) } });
  return { events, tables, handlerOptions: { callerClient, serviceClient: service } };
}

const post = (body, auth = 'Bearer user-token') => new Request('https://project.supabase.co/functions/v1/delete-account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
  body: JSON.stringify(body),
});
const indexOf = (events, predicate) => events.findIndex(predicate);

test("a sole guardian's household is deleted, the files purged, and the login deleted last", async () => {
  const { createDeleteAccountHandler } = await load();
  const s = fakeSupabase({
    tables: {
      family_members: [{ family_id: 'f1', guardian_id: 'u', created_at: '2026-01-01' }],
      families: [{ id: 'f1', created_by: 'u' }],
      athletes: [{ id: 'k1', family_id: 'f1' }, { id: 'k2', family_id: 'f1' }],
    },
    folders: {
      'athlete-media': { k1: ['a.jpg', 'b.jpg'], k2: ['c.jpg'] },
      'trainer-verification-docs': { u: ['id.pdf'] },
    },
  });
  const res = await createDeleteAccountHandler(s.handlerOptions)(post({ confirm: 'DELETE' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, families_deleted: 1, families_left: 0, files_removed: 4 });

  const householdGone = indexOf(s.events, e => e[0] === 'delete' && e[1] === 'families' && e[2] === 'id=f1');
  const firstPurge = indexOf(s.events, e => e[0] === 'remove');
  assert.ok(householdGone !== -1 && householdGone < firstPurge, 'rows go before files');
  assert.deepEqual(s.events.at(-1), ['deleteUser', 'u'], 'the login is deleted last, so a failure earlier leaves it retryable');
  assert.deepEqual(s.events.filter(e => e[0] === 'remove').map(e => [e[1], e[2]]), [
    ['athlete-media', ['k1/a.jpg', 'k1/b.jpg']],
    ['athlete-media', ['k2/c.jpg']],
    ['trainer-verification-docs', ['u/id.pdf']],
  ]);
});

test('a co-parent leaving keeps the children: ownership and consent pass to the guardian who stays', async () => {
  const { createDeleteAccountHandler } = await load();
  const s = fakeSupabase({
    tables: {
      family_members: [
        { family_id: 'f1', guardian_id: 'u', created_at: '2026-02-01' },
        { family_id: 'f1', guardian_id: 'h', created_at: '2026-01-01' },
      ],
      families: [{ id: 'f1', created_by: 'u' }],
      athletes: [{ id: 'k1', family_id: 'f1' }],
      athlete_invites: [{ athlete_id: 'k1', created_by: 'u' }],
      consent_records: [{ athlete_id: 'k1', guardian_id: 'u' }],
    },
    folders: { 'athlete-media': { k1: ['a.jpg'] } },
  });
  const res = await createDeleteAccountHandler(s.handlerOptions)(post({ confirm: 'DELETE' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, families_deleted: 0, families_left: 1, files_removed: 0 });

  assert.deepEqual(s.tables.families, [{ id: 'f1', created_by: 'h' }]);
  assert.deepEqual(s.tables.athletes, [{ id: 'k1', family_id: 'f1' }], 'the child stays');
  assert.equal(s.tables.athlete_invites[0].created_by, 'h');
  assert.equal(s.tables.consent_records[0].guardian_id, 'h', 'the legal basis for holding the child\'s data passes to the guardian who stays');
  assert.deepEqual(s.tables.family_members.map(m => m.guardian_id), ['h'], 'only the leaving guardian\'s membership is removed');
  assert.equal(indexOf(s.events, e => e[0] === 'remove' && e[1] === 'athlete-media'), -1, 'no child file is touched');
  assert.equal(indexOf(s.events, e => e[0] === 'delete' && e[1] === 'families'), -1);
  assert.deepEqual(s.events.at(-1), ['deleteUser', 'u']);
});

test('every nullable reference to the user is released before the login is deleted', async () => {
  const { createDeleteAccountHandler, NULLABLE_BACK_REFERENCES } = await load();
  const s = fakeSupabase();
  await createDeleteAccountHandler(s.handlerOptions)(post({ confirm: 'DELETE' }));
  const deletedAt = indexOf(s.events, e => e[0] === 'deleteUser');
  for (const [table, column] of NULLABLE_BACK_REFERENCES) {
    const released = indexOf(s.events, e => e[0] === 'update' && e[1] === table && e[2] === JSON.stringify({ [column]: null }) && e[3] === column + '=u');
    assert.ok(released !== -1 && released < deletedAt, table + '.' + column + ' must be released before the user is deleted');
  }
});

test('nothing is touched without a signed-in caller and a typed confirmation', async () => {
  const { createDeleteAccountHandler } = await load();
  for (const [request, status, options] of [
    [post({ confirm: 'DELETE' }, null), 401, {}],
    [post({}), 400, {}],
    [post({ confirm: 'delete' }), 400, {}],
    [post({ confirm: 'DELETE' }), 401, { user: null }],
  ]) {
    const s = fakeSupabase({ tables: { family_members: [{ family_id: 'f1', guardian_id: 'u', created_at: '1' }], families: [{ id: 'f1', created_by: 'u' }] }, ...options });
    const res = await createDeleteAccountHandler(s.handlerOptions)(request);
    assert.equal(res.status, status);
    assert.deepEqual(s.events, [], 'no write may happen before the caller and confirmation are established');
  }
});

test('a household that cannot be deleted stops before any file or login is touched', async () => {
  const { createDeleteAccountHandler } = await load();
  const s = fakeSupabase({
    tables: { family_members: [{ family_id: 'f1', guardian_id: 'u', created_at: '1' }], families: [{ id: 'f1', created_by: 'u' }], athletes: [{ id: 'k1', family_id: 'f1' }] },
    folders: { 'athlete-media': { k1: ['a.jpg'] } },
    familyDeleteError: { message: 'foreign key violation' },
  });
  const res = await createDeleteAccountHandler(s.handlerOptions)(post({ confirm: 'DELETE' }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'could not delete household: foreign key violation' });
  assert.equal(indexOf(s.events, e => e[0] === 'remove' || e[0] === 'deleteUser'), -1);
});

test('a login that cannot be deleted is reported as partial, after the data is gone', async () => {
  const { createDeleteAccountHandler } = await load();
  const s = fakeSupabase({
    tables: { family_members: [{ family_id: 'f1', guardian_id: 'u', created_at: '1' }], families: [{ id: 'f1', created_by: 'u' }] },
    deleteUserError: { message: 'update or delete on table "users" violates foreign key constraint' },
  });
  const res = await createDeleteAccountHandler(s.handlerOptions)(post({ confirm: 'DELETE' }));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.partial, true);
  assert.equal(body.families_deleted, 1);
  assert.match(body.error, /support@playbookbp\.com/);
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createDeleteAccountHandler \} from "\.\/handler\.mjs";/);
  assert.doesNotMatch(entry, /Deno\.env\.get\("SUPABASE_ANON_KEY"\)/);
  assert.match(entry, /createClient\(URL, PUBLISHABLE, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});

test("a parent's own training record is deleted, scoped to them, before the login", async () => {
  const { createDeleteAccountHandler, ADULT_TABLES } = await load();
  const s = fakeSupabase({ tables: { adult_goals: [{ guardian_id: 'u', label: 'mine' }, { guardian_id: 'someone-else', label: 'theirs' }] } });
  await createDeleteAccountHandler(s.handlerOptions)(post({ confirm: 'DELETE' }));
  const deletedAt = indexOf(s.events, e => e[0] === 'deleteUser');
  assert.ok(deletedAt !== -1);
  for (const table of ADULT_TABLES) {
    const at = indexOf(s.events, e => e[0] === 'delete' && e[1] === table && e[2] === 'guardian_id=u');
    assert.ok(at !== -1 && at < deletedAt, table + ' must be deleted for the caller before the login is');
  }
  assert.deepEqual(s.tables.adult_goals, [{ guardian_id: 'someone-else', label: 'theirs' }], "another guardian's record is untouched");
});
