// The HTTP half of the organization results API.
//
// Every authorization decision is made in the database, by the functions in
// supabase/migrations/20260913120000_company_results_api.sql: key lookup by hash, expiry, revocation,
// scope, rate limit, tenant, roster and live consent. This file only maps HTTP onto those functions and
// database errors back onto HTTP. It imports nothing from Deno or Supabase, so the same file runs under
// the edge runtime and under Node's test runner.
//
//   GET    /v1/body-assessments?limit=50&cursor=...      a page of the organization's results
//   GET    /v1/reference-assessments/{id}                one result
//   DELETE /v1/reference-assessments/{id}                delete one result (needs results:delete)
//
//   Authorization: Bearer ppk_<prefix>_<secret>

export const API_VERSION = 'v1';

// URL resource name -> the kind the database functions accept.
export const KINDS = Object.freeze({
  'body-assessments': 'body_assessments',
  'reference-assessments': 'reference_assessments',
});

const KEY = /^ppk_[0-9a-f]{8}_[0-9a-f]{56}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SQLSTATEs the database functions raise on purpose. Their messages are written for the caller and
// carry no row content. Any other error is reported generically, because its message might.
const EXPECTED_ERRORS = Object.freeze({
  '28000': [401, 'invalid_key'],
  '42501': [403, 'insufficient_scope'],
  '54000': [429, 'rate_limited'],
  '22023': [400, 'invalid_request'],
});

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

function respond(status, body, type, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': type, ...extra } });
}
const json = (status, body) => respond(status, body, 'application/json; charset=utf-8');
const problem = (status, error, detail, extra) => respond(status, { status, error, detail }, 'application/problem+json; charset=utf-8', extra);

const CHALLENGE = 'Bearer realm="company-results-api"';

function bearer(header) {
  const match = /^Bearer\s+(\S+)$/i.exec(header || '');
  return match && KEY.test(match[1]) ? match[1] : null;
}

export function createResultsApiHandler({ rpc, functionName = 'company-results-api' } = {}) {
  if (typeof rpc !== 'function') throw new TypeError('createResultsApiHandler needs an rpc(name, args) function');

  return async function handle(request) {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    // The edge runtime may or may not include the function's own name in the path.
    const at = segments.indexOf(functionName);
    const route = at === -1 ? segments : segments.slice(at + 1);

    if (route[0] !== API_VERSION) return problem(404, 'not_found', 'Unknown API version. Use /' + API_VERSION + '/.');
    const kind = Object.hasOwn(KINDS, route[1] || '') ? KINDS[route[1]] : null;
    if (!kind || route.length > 3) return problem(404, 'not_found', 'Unknown resource.');

    const id = route[2];
    const allowed = id ? ['GET', 'DELETE'] : ['GET'];
    if (!allowed.includes(request.method)) {
      return problem(405, 'method_not_allowed', 'Use ' + allowed.join(' or ') + '.', { Allow: allowed.join(', ') });
    }

    // Checked before anything else about the request is examined, so an unauthenticated caller
    // learns nothing about which ids or parameters are valid.
    const secret = bearer(request.headers.get('authorization'));
    if (!secret) return problem(401, 'unauthorized', 'Send an organization API key as Authorization: Bearer ppk_...', { 'WWW-Authenticate': CHALLENGE });

    let name;
    let args;
    if (!id) {
      const limit = url.searchParams.get('limit');
      if (limit !== null && !/^\d{1,3}$/.test(limit)) return problem(400, 'invalid_request', 'limit must be an integer from 1 to 100.');
      name = 'company_results_api_list';
      args = { p_secret: secret, p_kind: kind, p_cursor: url.searchParams.get('cursor'), p_limit: limit === null ? 50 : Number(limit) };
    } else {
      if (!UUID.test(id)) return problem(400, 'invalid_request', 'Result ids are UUIDs.');
      name = request.method === 'GET' ? 'company_results_api_get' : 'company_results_api_delete';
      args = { p_secret: secret, p_kind: kind, p_id: id.toLowerCase() };
    }

    let outcome;
    try {
      outcome = await rpc(name, args);
    } catch {
      return problem(502, 'upstream_unavailable', 'The results store could not be reached.');
    }
    const { data, error } = outcome || {};
    if (error) {
      const expected = EXPECTED_ERRORS[error.code];
      if (!expected) return problem(500, 'internal_error', 'The request could not be completed.');
      const [status, code] = expected;
      const extra = status === 429 ? { 'Retry-After': '60' } : status === 401 ? { 'WWW-Authenticate': CHALLENGE + ', error="invalid_token"' } : {};
      return problem(status, code, String(error.message || '').slice(0, 200), extra);
    }
    // Absent and not-yours are the same answer, so a key cannot probe another organization's ids.
    if (data === null || data === undefined || (request.method === 'DELETE' && data.deleted !== true)) {
      return problem(404, 'not_found', 'No such result for this organization.');
    }
    return json(200, data);
  };
}
