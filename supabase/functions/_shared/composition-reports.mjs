// Reports attached to imported body composition results (a DXA printout, a clinic PDF), found and removed through the
// Storage API. Shared by delete-athlete, delete-account and composition-report-retention.
//
// A report's file must be gone before its attachment row can be deleted: the database refuses otherwise
// (20260915200000), because a row removed from SQL leaves the file's bytes behind and Supabase refuses that DELETE
// anyway. So every function that deletes something a report hangs off removes the report first, here, with the
// service client, which the bucket's policies do not limit. Removing a file that is already gone is not an error, so a
// retry after a failure part-way finishes the job.

export const REPORT_BUCKET = 'composition-reports';
const BATCH = 100;

// A database the body composition migration has not reached has none of these tables, and so no reports.
const missingTable = error => !!error && (error.code === 'PGRST205' || error.code === '42P01');

// The storage keys of every report attached to records matching column = one of values.
export async function reportKeysFor(db, column, values) {
  const ids = [...new Set((values || []).filter(Boolean))];
  if (!ids.length) return { keys: [], error: null };
  const records = await db.from('external_composition_records').select('id').in(column, ids);
  if (records.error) return missingTable(records.error) ? { keys: [], error: null } : { keys: [], error: records.error };
  const recordIds = (records.data || []).map(r => r.id);
  if (!recordIds.length) return { keys: [], error: null };
  const keys = [];
  for (let i = 0; i < recordIds.length; i += BATCH) {
    const attachments = await db.from('external_composition_attachments').select('storage_key').in('record_uuid', recordIds.slice(i, i + BATCH));
    if (attachments.error) return missingTable(attachments.error) ? { keys: [], error: null } : { keys: [], error: attachments.error };
    for (const a of attachments.data || []) if (a.storage_key) keys.push(a.storage_key);
  }
  return { keys: [...new Set(keys)], error: null };
}

// Removes the files through the Storage API, a batch at a time. Stops at the first refusal and says how many went.
export async function removeReports(db, keys) {
  const unique = [...new Set((keys || []).filter(Boolean))];
  let removed = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const { error } = await db.storage.from(REPORT_BUCKET).remove(chunk);
    if (error) return { removed, error };
    removed += chunk.length;
  }
  return { removed, error: null };
}
