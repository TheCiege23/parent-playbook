// composition-report-retention: the part of body composition retention that SQL cannot do.
//
// The nightly sweep (private.sweep_external_composition_retention, cron 'external-composition-retention' at 03:55 UTC)
// deletes records past their retention date and child records whose biometric release was withdrawn. It cannot delete
// one whose report file is still stored: the database refuses to delete an attachment while its file exists, because
// removing the row from SQL would leave the file's bytes behind (20260915200000). Only the Storage API removes a file.
//
// So this runs first, at 03:45 UTC ('external-composition-report-retention'): it asks the database which stored reports
// are holding back a due record (public.composition_reports_due_for_removal, by the sweep's own condition), removes
// them through the Storage API as the service role, and runs the sweep (public.run_external_composition_retention) so
// those records go tonight rather than tomorrow. A batch at a time: when a batch is full it says so, and the next run,
// or a manual call, takes the rest. Removing a file that is already gone is not an error, so a retry finishes the job.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/composition-report-retention-function.test.cjs). Only the scheduler may call it.

import { isScheduler, bearerOf } from '../_shared/push-policy.mjs';
import { removeReports } from '../_shared/composition-reports.mjs';

export const BATCH = 500;

export function createCompositionReportRetentionHandler({ db, env = {}, batch = BATCH } = {}) {
  if (!db) throw new TypeError('createCompositionReportRetentionHandler needs db');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!isScheduler(bearerOf(req), env.SERVICE_KEY)) return json({ error: 'forbidden' }, 403);

      const due = await db.rpc('composition_reports_due_for_removal', { p_limit: batch });
      if (due.error) return json({ error: 'could not list the reports holding back due records' }, 500);
      const rows = Array.isArray(due.data) ? due.data : [];
      const keys = [...new Set(rows.map(row => row?.storage_key).filter(Boolean))];

      const removal = await removeReports(db, keys);
      if (removal.error) return json({ error: 'could not remove every due report', reports_removed: removal.removed }, 500);

      const swept = await db.rpc('run_external_composition_retention');
      if (swept.error) return json({ error: 'the reports were removed but the sweep failed', reports_removed: removal.removed }, 500);

      return json({ ok: true, reports_removed: removal.removed, records_deleted: Number(swept.data) || 0, more: rows.length >= batch });
    } catch (e) {
      return json({ error: e?.message ?? String(e) }, 500);
    }
  };
}
