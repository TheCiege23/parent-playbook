// delete-athlete: a parent deletes one child's profile and every file stored for it.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/delete-athlete-function.test.cjs). The order is what makes it safe:
//
//   1. list every file under the athlete's storage folder with the service client, which sees them all;
//   2. ask, as the CALLER, whether they may delete this athlete (public.can_delete_athlete answers exactly as the
//      athletes delete policy does), and stop if not;
//   3. remove the reports attached to the athlete's imported body composition results, with the service client and
//      through the Storage API. The database refuses to delete an attachment whose file is still stored, so these go
//      before the row, and step 2 is what makes that safe: a refused caller never reaches a file;
//   4. delete the athlete row with the CALLER's client, so row-level security still decides;
//   5. only once that delete removed a row, purge the photos and videos with the service client.
//
// The service client never deletes a database row here, and if the caller is refused nothing is purged.

import { reportKeysFor, removeReports } from '../_shared/composition-reports.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

const PAGE = 100;

export function createDeleteAthleteHandler({ callerClient, serviceClient, bucket = 'athlete-media' } = {}) {
  if (typeof callerClient !== 'function' || !serviceClient) throw new TypeError('createDeleteAthleteHandler needs callerClient(authHeader) and serviceClient');

  return async function handle(req) {
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const auth = req.headers.get('Authorization') || '';
      if (!auth) return json({ error: 'missing auth' }, 401);
      const body = await req.json().catch(() => ({}));
      const athleteId = body?.athlete_id;
      if (!athleteId) return json({ error: 'athlete_id required' }, 400);

      const caller = callerClient(auth);

      // 1) collect every file under the athlete's folder (the service client sees all of them)
      const paths = [];
      let offset = 0;
      while (true) {
        const { data: files, error } = await serviceClient.storage.from(bucket).list(athleteId, { limit: PAGE, offset });
        if (error || !files || files.length === 0) break;
        for (const f of files) paths.push(`${athleteId}/${f.name}`);
        if (files.length < PAGE) break;
        offset += PAGE;
      }

      // 2) may this caller delete this athlete? Asked as the caller, before any file is touched
      const { data: allowed, error: askErr } = await caller.rpc('can_delete_athlete', { p_athlete: athleteId });
      if (askErr) return json({ error: askErr.message }, 403);
      if (allowed !== true) return json({ error: 'not found or not permitted' }, 403);

      // 3) the reports behind the athlete's imported body composition results, through the Storage API, before the row
      const reports = await reportKeysFor(serviceClient, 'athlete_id', [athleteId]);
      if (reports.error) return json({ error: 'could not read the reports attached to imported results' }, 500);
      const removal = await removeReports(serviceClient, reports.keys);
      if (removal.error) return json({ error: 'could not remove the reports attached to imported results; nothing was deleted' }, 500);

      // 4) delete the athlete as the CALLER; row-level security enforces that they own it
      const { error: delErr, count } = await caller.from('athletes').delete({ count: 'exact' }).eq('id', athleteId);
      if (delErr) return json({ error: delErr.message }, 403);
      if (!count) return json({ error: 'not found or not permitted' }, 403);

      // 5) ownership confirmed and the row is gone, so purge the actual files (service client)
      let filesRemoved = removal.removed;
      if (paths.length) {
        const { error: rmErr } = await serviceClient.storage.from(bucket).remove(paths);
        if (!rmErr) filesRemoved += paths.length;
      }
      return json({ ok: true, files_removed: filesRemoved });
    } catch (e) {
      return json({ error: e?.message ?? String(e) }, 500);
    }
  };
}
