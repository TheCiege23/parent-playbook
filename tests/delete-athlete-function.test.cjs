// delete-athlete deletes a child's profile and every file stored for it. Its safety is its order: the
// files are listed first, the CALLER is asked whether they may delete the athlete before any file is
// touched, the reports behind imported body composition results go through the Storage API before the
// row (the database refuses to delete an attachment whose file is still stored), the row is deleted by
// the CALLER so row-level security decides, and the photos are purged only after that delete removed a
// row. The logic lives in handler.mjs, and these tests pin the order and the refusals with recording
// stand-ins for the two Supabase clients.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dir = path.join(__dirname, '../supabase/functions/delete-athlete');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const ATHLETE = 'a1111111-1111-4111-8111-11111111111a';
const RECORD = 'r1111111-1111-4111-8111-11111111111r';

function world({ files = [], reports = [], allowed = true, askError = null, deleteError = null, deleted = 1, removeError = null, reportRemoveError = null } = {}) {
  const events = [];
  const serviceClient = {
    // Reads only. The service client never deletes, inserts or updates a row here.
    from(table) {
      const refuse = verb => () => { throw new Error('the service client must never ' + verb + ' a row here: ' + table); };
      return {
        insert: refuse('insert'), update: refuse('update'), delete: refuse('delete'), upsert: refuse('upsert'),
        select: () => ({
          in: async (column, values) => {
            events.push(['service.read', table, column, [...values]]);
            if (table === 'external_composition_records') return { data: reports.length ? [{ id: RECORD }] : [], error: null };
            return { data: reports.map(storage_key => ({ storage_key })), error: null };
          },
        }),
      };
    },
    storage: {
      from: bucket => ({
        list: async (folder, { limit, offset }) => {
          events.push(['list', bucket, folder, offset]);
          return { data: files.slice(offset, offset + limit).map(name => ({ name })), error: null };
        },
        remove: async paths => {
          events.push(['remove', bucket, [...paths]]);
          return { error: bucket === 'composition-reports' ? reportRemoveError : removeError };
        },
      }),
    },
  };
  const callerClient = auth => {
    events.push(['caller', auth]);
    return {
      rpc: async (name, args) => { events.push(['caller.rpc', name, args]); return { data: askError ? null : allowed, error: askError }; },
      from: table => ({
        delete: options => ({
          eq: async (column, value) => {
            events.push(['caller.delete', table, column, value, options]);
            return { error: deleteError, count: deleted };
          },
        }),
      }),
    };
  };
  return { events, callerClient, serviceClient };
}

const post = (body, auth = 'Bearer user-token') => new Request('https://project.supabase.co/functions/v1/delete-athlete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
  body: JSON.stringify(body),
});
const at = (events, kind, bucket) => events.findIndex(event => event[0] === kind && (bucket === undefined || event[1] === bucket));

test('files are listed first, the caller is asked, reports go before the row, and photos are purged only afterwards', async () => {
  const { createDeleteAthleteHandler } = await load();
  const files = Array.from({ length: 250 }, (_, i) => 'photo-' + i + '.jpg');
  const w = world({ files, reports: [RECORD + '/report.pdf'] });
  const res = await createDeleteAthleteHandler(w)(post({ athlete_id: ATHLETE }));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, files_removed: 251 });
  assert.deepEqual(w.events.filter(e => e[0] === 'list').map(e => e[3]), [0, 100, 200], 'the folder is read page by page');
  const lastList = w.events.map(e => e[0]).lastIndexOf('list');
  assert.ok(lastList < at(w.events, 'caller.rpc'), 'every file is listed first');
  assert.deepEqual(w.events[at(w.events, 'caller.rpc')], ['caller.rpc', 'can_delete_athlete', { p_athlete: ATHLETE }]);
  assert.ok(at(w.events, 'caller.rpc') < at(w.events, 'remove', 'composition-reports'), 'no report is touched before the caller is known to be allowed');
  assert.deepEqual(w.events[at(w.events, 'remove', 'composition-reports')], ['remove', 'composition-reports', [RECORD + '/report.pdf']]);
  assert.ok(at(w.events, 'remove', 'composition-reports') < at(w.events, 'caller.delete'), 'reports go before the row, which the database requires');
  assert.ok(at(w.events, 'caller.delete') < at(w.events, 'remove', 'athlete-media'), 'photos are purged only after the delete');
  assert.deepEqual(w.events[at(w.events, 'caller.delete')], ['caller.delete', 'athletes', 'id', ATHLETE, { count: 'exact' }]);
  assert.deepEqual(w.events.find(e => e[0] === 'caller'), ['caller', 'Bearer user-token'], 'the question and the delete run with the caller\'s own authorization');
  const removed = w.events.find(e => e[0] === 'remove' && e[1] === 'athlete-media');
  assert.equal(removed[2].length, 250);
  assert.ok(removed[2].every(p => p.startsWith(ATHLETE + '/')));
});

test('a caller who may not delete the athlete reaches no report, no row and no photo', async () => {
  const { createDeleteAthleteHandler } = await load();
  for (const w of [world({ files: ['a.jpg'], reports: ['r/report.pdf'], allowed: false }), world({ files: ['a.jpg'], reports: ['r/report.pdf'], askError: { message: 'permission denied' } })]) {
    const res = await createDeleteAthleteHandler(w)(post({ athlete_id: ATHLETE }));
    assert.equal(res.status, 403);
    assert.equal(at(w.events, 'service.read'), -1, 'not even the reports are looked up');
    assert.equal(at(w.events, 'remove'), -1);
    assert.equal(at(w.events, 'caller.delete'), -1);
  }
});

test('a report the Storage API will not remove stops everything before the row', async () => {
  const { createDeleteAthleteHandler } = await load();
  const w = world({ files: ['a.jpg'], reports: [RECORD + '/report.pdf'], reportRemoveError: { message: 'storage unavailable' } });
  const res = await createDeleteAthleteHandler(w)(post({ athlete_id: ATHLETE }));
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /nothing was deleted/);
  assert.equal(at(w.events, 'caller.delete'), -1);
  assert.equal(at(w.events, 'remove', 'athlete-media'), -1);
});

test('a refused or empty delete purges no photo', async () => {
  const { createDeleteAthleteHandler } = await load();

  const refused = world({ files: ['a.jpg'], deleteError: { message: 'permission denied for table athletes' } });
  const denied = await createDeleteAthleteHandler(refused)(post({ athlete_id: ATHLETE }));
  assert.equal(denied.status, 403);
  assert.equal(at(refused.events, 'remove', 'athlete-media'), -1, 'a refused delete must not purge anyone\'s files');

  const nothing = world({ files: ['a.jpg'], deleted: 0 });
  const missing = await createDeleteAthleteHandler(nothing)(post({ athlete_id: ATHLETE }));
  assert.equal(missing.status, 403);
  assert.deepEqual(await missing.json(), { error: 'not found or not permitted' });
  assert.equal(at(nothing.events, 'remove', 'athlete-media'), -1, 'a delete that matched no row, such as another family\'s child, purges nothing');
});

test('no client is used without a caller and an athlete', async () => {
  const { createDeleteAthleteHandler } = await load();
  const w = world({ files: ['a.jpg'] });
  const handle = createDeleteAthleteHandler(w);
  assert.equal((await handle(post({ athlete_id: ATHLETE }, null))).status, 401);
  assert.equal((await handle(post({}))).status, 400);
  assert.deepEqual(w.events, []);
  const preflight = await handle(new Request('https://project.supabase.co/functions/v1/delete-athlete', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('a failed photo removal is reported as nothing removed', async () => {
  // Pinned as it behaves today. The row is already gone when removal fails, so a retry through this
  // function cannot find the folder's owner again. That gap is recorded here rather than papered over.
  const { createDeleteAthleteHandler } = await load();
  const w = world({ files: ['a.jpg', 'b.jpg'], removeError: { message: 'storage unavailable' } });
  const res = await createDeleteAthleteHandler(w)(post({ athlete_id: ATHLETE }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, files_removed: 0 });
});

test('the entry point uses the publishable key for the caller and adds no logic', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createDeleteAthleteHandler \} from "\.\/handler\.mjs";/);
  assert.doesNotMatch(entry, /Deno\.env\.get\("SUPABASE_ANON_KEY"\)/, 'the legacy anon key must not be read');
  assert.match(entry, /createClient\(URL, PUBLISHABLE, \{ global: \{ headers: \{ Authorization: auth \} \} \}\)/);
  assert.doesNotMatch(entry, /\.from\(/);
});
