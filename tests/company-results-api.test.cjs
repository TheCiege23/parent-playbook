// The organization results API decides nothing in HTTP: the database functions authenticate the key and
// scope every row (tests/db/security-tests.cjs covers those). What the handler can still get wrong is
// the mapping. It could reach the database without a key, echo an unexpected database message that
// carries row content, answer differently for another organization's id than for a missing one, or
// send CORS headers that invite a browser to hold an organization key. These tests pin that mapping
// with a recording stand-in for the database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dir = path.join(__dirname, '../supabase/functions/company-results-api');
const load = () => import(pathToFileURL(path.join(dir, 'handler.mjs')).href);

const SECRET = 'ppk_0123abcd_' + 'f'.repeat(56);
const ID = '5b0c6f1e-7d2a-4c3b-9e8f-0a1b2c3d4e5f';

function recorder(outcome = { data: { schema: 'PP_COMPANY_RESULTS_PAGE_V1', items: [], nextCursor: null }, error: null }) {
  const calls = [];
  const rpc = async (name, args) => { calls.push({ name, args }); return typeof outcome === 'function' ? outcome(name, args) : outcome; };
  return { calls, rpc };
}

const call = (handle, pathname, { method = 'GET', key = SECRET, headers = {} } = {}) =>
  handle(new Request('https://project.supabase.co' + pathname, {
    method,
    headers: { ...(key === null ? {} : { Authorization: 'Bearer ' + key }), ...headers },
  }));

test('a list request reaches the database once, with the key, and answers without caching or CORS', async () => {
  const { createResultsApiHandler } = await load();
  const db = recorder();
  const handle = createResultsApiHandler({ rpc: db.rpc });
  const res = await call(handle, '/company-results-api/v1/reference-assessments?limit=25&cursor=abc123');

  assert.equal(res.status, 200);
  assert.deepEqual(db.calls, [{ name: 'company_results_api_list', args: { p_secret: SECRET, p_kind: 'reference_assessments', p_cursor: 'abc123', p_limit: 25 } }]);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'an organization key must not be usable from a browser page');
  assert.ok(!(await res.text()).includes(SECRET), 'the key must never be echoed');

  const defaults = recorder();
  await call(createResultsApiHandler({ rpc: defaults.rpc }), '/functions/v1/company-results-api/v1/body-assessments');
  assert.deepEqual(defaults.calls[0].args, { p_secret: SECRET, p_kind: 'body_assessments', p_cursor: null, p_limit: 50 });
});

test('without a well-formed key nothing reaches the database', async () => {
  const { createResultsApiHandler } = await load();
  const db = recorder();
  const handle = createResultsApiHandler({ rpc: db.rpc });
  for (const key of [null, 'not-a-key', 'ppk_short_abc', SECRET.toUpperCase()]) {
    const res = await call(handle, '/v1/reference-assessments/' + ID, { key });
    assert.equal(res.status, 401, String(key));
    assert.match(res.headers.get('www-authenticate') || '', /^Bearer realm="company-results-api"/);
  }
  const basic = await call(handle, '/v1/reference-assessments', { key: null, headers: { Authorization: 'Basic ' + Buffer.from('a:b').toString('base64') } });
  assert.equal(basic.status, 401);
  // An unauthenticated caller learns nothing about whether an id is well formed.
  assert.equal((await call(handle, '/v1/reference-assessments/not-a-uuid', { key: null })).status, 401);
  assert.deepEqual(db.calls, []);
});

test('unknown routes, methods and parameters are refused before the database', async () => {
  const { createResultsApiHandler } = await load();
  const db = recorder();
  const handle = createResultsApiHandler({ rpc: db.rpc });
  const cases = [
    ['/v2/reference-assessments', 'GET', 404],
    ['/v1/composition-results', 'GET', 404],
    ['/v1/constructor', 'GET', 404],
    ['/v1/reference-assessments/' + ID + '/extra', 'GET', 404],
    ['/v1/reference-assessments', 'POST', 405],
    ['/v1/reference-assessments', 'DELETE', 405],
    ['/v1/reference-assessments/' + ID, 'PUT', 405],
    ['/v1/reference-assessments/not-a-uuid', 'GET', 400],
    ['/v1/reference-assessments?limit=abc', 'GET', 400],
    ['/v1/reference-assessments?limit=-1', 'GET', 400],
  ];
  for (const [pathname, method, status] of cases) {
    const res = await call(handle, pathname, { method });
    assert.equal(res.status, status, method + ' ' + pathname);
    assert.match(res.headers.get('content-type'), /^application\/problem\+json/);
  }
  assert.equal((await call(handle, '/v1/reference-assessments', { method: 'POST' })).headers.get('allow'), 'GET');
  assert.deepEqual(db.calls, []);
});

test('database refusals map to their HTTP meaning, and anything unexpected says nothing', async () => {
  const { createResultsApiHandler } = await load();
  const expectations = [
    ['28000', 401, 'invalid API key'],
    ['42501', 403, 'this API key does not carry the results:delete scope'],
    ['54000', 429, 'rate limit of 120 requests per minute exceeded'],
    ['22023', 400, 'invalid cursor'],
  ];
  for (const [code, status, message] of expectations) {
    const handle = createResultsApiHandler({ rpc: recorder({ data: null, error: { code, message } }).rpc });
    const res = await call(handle, '/v1/reference-assessments');
    assert.equal(res.status, status, code);
    assert.equal((await res.json()).detail, message);
    if (status === 429) assert.equal(res.headers.get('retry-after'), '60');
  }

  const leaky = createResultsApiHandler({ rpc: recorder({ data: null, error: { code: '23514', message: 'row for athlete SyntheticRosterA violates check' } }).rpc });
  const hidden = await call(leaky, '/v1/body-assessments');
  assert.equal(hidden.status, 500);
  assert.ok(!(await hidden.text()).includes('SyntheticRosterA'), 'an unexpected database message must not reach the caller');

  const down = createResultsApiHandler({ rpc: async () => { throw new Error('connect ECONNREFUSED'); } });
  assert.equal((await call(down, '/v1/body-assessments')).status, 502);
});

test('a missing result and another organization\'s result get the same answer', async () => {
  const { createResultsApiHandler } = await load();
  const get = recorder({ data: null, error: null });
  const res = await call(createResultsApiHandler({ rpc: get.rpc }), '/v1/body-assessments/' + ID.toUpperCase());
  assert.equal(res.status, 404);
  assert.deepEqual(get.calls[0], { name: 'company_results_api_get', args: { p_secret: SECRET, p_kind: 'body_assessments', p_id: ID } });

  const gone = recorder({ data: { schema: 'PP_COMPANY_RESULT_DELETION_V1', deleted: false }, error: null });
  assert.equal((await call(createResultsApiHandler({ rpc: gone.rpc }), '/v1/reference-assessments/' + ID, { method: 'DELETE' })).status, 404);
  assert.equal(gone.calls[0].name, 'company_results_api_delete');

  const deleted = recorder({ data: { schema: 'PP_COMPANY_RESULT_DELETION_V1', kind: 'reference_assessments', id: ID, deleted: true }, error: null });
  const ok = await call(createResultsApiHandler({ rpc: deleted.rpc }), '/v1/reference-assessments/' + ID, { method: 'DELETE' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).deleted, true);
});

test('the deployed entry point adds no logic of its own and no CORS', () => {
  const entry = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.match(entry, /import \{ createResultsApiHandler \} from "\.\/handler\.mjs";/);
  assert.match(entry, /--no-verify-jwt/, 'the deployment instruction must say JWT verification is off and why');
  assert.doesNotMatch(entry, /Access-Control-Allow/i);
  assert.equal((entry.match(/service\.rpc\(/g) || []).length, 1);
  assert.doesNotMatch(entry, /\.from\(/, 'the entry point must not read tables directly; the database functions scope every row');
});
