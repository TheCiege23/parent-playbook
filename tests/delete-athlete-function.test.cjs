// delete-athlete deletes a child's profile and every file stored for it. Its safety is its order: the
// files are listed first, the row is deleted by the CALLER so row-level security decides, and the files
// are purged only after that delete removed a row. None of that had a test, because the function could
// only run in the edge runtime. The logic now lives in handler.mjs, and these tests pin the order and
// the refusals with recording stand-ins for the two Supabase clients.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dir = path.join(__dirname, '../supabase/functions/delete-athlete');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);
const ATHLETE = 'a1111111-1111-4111-8111-11111111111a';

function world({ files = [], deleteError = null, deleted = 1, removeError = null } = {}) {
  const events = [];
  const serviceClient = {
    from(table) {
      events.push(['service.from', table]);
      throw new Error('the service client must never touch a table here: ' + table);
    },
    storage: {
      from: bucket => ({
        list: async (folder, { limit, offset }) => {
          events.push(['list', bucket, folder, offset]);
          return { data: files.slice(offset, offset + limit).map(name => ({ name })), error: null };
        },
        remove: async paths => { events.push(['remove', bucket, [...paths]]); return { error: removeError }; },
      }),
    },
  };
  const callerClient = auth => {
    events.push(['caller', auth]);
    return {
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
const at = (events, kind) => events.findIndex(event => event[0] === kind);

test('files are listed first, the caller deletes the row, and files are purged only afterwards', async () => {
  const { createDeleteAthleteHandler } = await load();
  const files = Array.from({ length: 250 }, (_, i) => 'photo-' + i + '.jpg');
  const w = world({ files });
  const res = await createDeleteAthleteHandler(w)(post({ athlete_id: ATHLETE }));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, files_removed: 250 });
  assert.deepEqual(w.events.filter(e => e[0] === 'list').map(e => e[3]), [0, 100, 200], 'the folder is read page by page');
  const lastList = w.events.map(e => e[0]).lastIndexOf('list');
  assert.ok(lastList < at(w.events, 'caller.delete'), 'every file is listed before the row disappears');
  assert.ok(at(w.events, 'caller.delete') < at(w.events, 'remove'), 'files are purged only after the delete');
  assert.deepEqual(w.events[at(w.events, 'caller.delete')], ['caller.delete', 'athletes', 'id', ATHLETE, { count: 'exact' }]);
  assert.deepEqual(w.events.find(e => e[0] === 'caller'), ['caller', 'Bearer user-token'], 'the delete runs with the caller\'s own authorization');
  const removed = w.events.find(e => e[0] === 'remove');
  assert.equal(removed[1], 'athlete-media');
  assert.equal(removed[2].length, 250);
  assert.ok(removed[2].every(p => p.startsWith(ATHLETE + '/')));
});

test('a refused or empty delete purges nothing', async () => {
  const { createDeleteAthleteHandler } = await load();

  const refused = world({ files: ['a.jpg'], deleteError: { message: 'permission denied for table athletes' } });
  const denied = await createDeleteAthleteHandler(refused)(post({ athlete_id: ATHLETE }));
  assert.equal(denied.status, 403);
  assert.equal(at(refused.events, 'remove'), -1, 'a refused delete must not purge anyone\'s files');

  const nothing = world({ files: ['a.jpg'], deleted: 0 });
  const missing = await createDeleteAthleteHandler(nothing)(post({ athlete_id: ATHLETE }));
  assert.equal(missing.status, 403);
  assert.deepEqual(await missing.json(), { error: 'not found or not permitted' });
  assert.equal(at(nothing.events, 'remove'), -1, 'a delete that matched no row, such as another family\'s child, purges nothing');
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

test('a failed file removal is reported as nothing removed', async () => {
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
