/* Writing imported composition records to Supabase, and the report documents that back them.
 *
 * The database is the authority here, not this file. Every rule that matters — what a source may
 * claim, whether a child's release is live, whether this reading already exists — is a constraint,
 * a trigger or a policy on public.external_composition_records, and they hold whichever key is
 * writing. What this adapter adds is the part a constraint cannot: turning "duplicate key value
 * violates external_composition_reading_idx" into "you already have this reading", per record,
 * for a person who just dropped in a forty-row export.
 *
 * A duplicate is deliberately NOT an error. Record ids are derived from the reading itself, so
 * re-importing last month's export is the normal way to pick up the four readings since — and the
 * thirty-six it repeats should land as "already had it", not as thirty-six failures.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE = 'external_composition_records';
const ATTACHMENTS = 'external_composition_attachments';
const BUCKET = 'composition-reports';
const MAX_ROWS = 400;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_TYPES = Object.freeze({
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'text/csv': 'csv',
});

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'CompositionImportPersistenceError', code }); };
const uuid = (value, label) => { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_SCOPE', label + ' must be a UUID.'); return value.toLowerCase(); };
const clone = value => JSON.parse(JSON.stringify(value));

// Postgres says the same thing several ways depending on which guard caught it. Each of these is
// a sentence someone can act on, which the raw message is not.
function readDbError(error) {
  const message = String(error?.message || '');
  if (/external_composition_reading_idx|external_composition_identity_idx|external_composition_source_sample_idx/.test(message)) {
    return { outcome: 'already_present', reason: 'You already have this reading.' };
  }
  if (/not live for this athlete/.test(message)) {
    return { outcome: 'refused', reason: 'The biometric release for this athlete is not live. Record or restore it before importing.' };
  }
  if (/row-level security/.test(message)) {
    return { outcome: 'refused', reason: 'You do not have permission to import a record for this subject.' };
  }
  if (/violates check constraint/.test(message)) {
    return { outcome: 'refused', reason: 'The database refused this reading as outside what its source can report or what a plausible value looks like.' };
  }
  return { outcome: 'refused', reason: message.trim() || 'Supabase rejected the record.' };
}

/* The live biometric release covering a child, by id.
 *
 * Looked up rather than accepted from a caller, because a consent id that arrives alongside the
 * record it authorises is not evidence of anything. A record for an adult reference needs none.
 */
export async function findLiveConsent(client, athleteId) {
  const today = new Date().toISOString().slice(0, 10);
  const response = await client.from('biometric_consents')
    .select('id,granted_at,retention_until')
    .eq('athlete_id', uuid(athleteId, 'athleteId'))
    .is('revoked_at', null)
    .gte('retention_until', today)
    .order('granted_at', { ascending: false })
    .limit(1);
  if (response?.error) fail('CONSENT_LOOKUP', response.error.message || 'Could not check the biometric release.');
  const row = Array.isArray(response?.data) ? response.data[0] : null;
  return row ? Object.freeze({ id: row.id, retentionUntil: row.retention_until }) : null;
}

export function createExternalCompositionStore(client, { scope, athleteId = null, subjectReference } = {}) {
  if (!client?.auth || typeof client.auth.getSession !== 'function' || typeof client.from !== 'function') {
    fail('INVALID_SUPABASE_CLIENT', 'A Supabase client with auth and database access is required.');
  }
  if (!['adult_reference', 'child_athlete'].includes(scope)) fail('INVALID_SCOPE', 'scope must be adult_reference or child_athlete.');

  let athlete = null, subjectId;
  if (scope === 'child_athlete') {
    athlete = uuid(athleteId, 'athleteId');
    subjectId = uuid(subjectReference ?? athleteId, 'subjectReference');
    // The table enforces this too. Catching it here means the mismatch is reported before a
    // forty-row import is attempted rather than forty times during it.
    if (subjectId !== athlete) fail('INVALID_SCOPE', "A child record's subject reference is that athlete's id.");
  } else {
    if (athleteId != null) fail('INVALID_SCOPE', 'An adult reference must not name a child athlete.');
    if (typeof subjectReference !== 'string' || !subjectReference.trim()) fail('INVALID_SCOPE', 'An adult reference needs a subject label.');
    subjectId = subjectReference;
  }

  async function guardian() {
    const response = await client.auth.getSession();
    if (response?.error) fail('AUTH_REQUIRED', response.error.message || 'Could not read the session.');
    const id = response?.data?.session?.user?.id;
    if (!id || !UUID.test(id)) fail('AUTH_REQUIRED', 'Sign in before importing a measurement.');
    return id.toLowerCase();
  }

  const scoped = query => {
    const q = query.eq('subject_reference', subjectId).eq('subject_scope', scope);
    return athlete == null ? q.is('athlete_id', null) : q.eq('athlete_id', athlete);
  };

  return Object.freeze({
    scope, subjectId, athleteId: athlete,

    /* Save validated records, one at a time and reporting each one.
     *
     * Deliberately not a batch insert: a batch fails whole, so one repeated reading in a
     * forty-row export would throw away thirty-nine good ones. The rows are small and an import
     * is not a hot path.
     */
    async save(records, { consentId = null } = {}) {
      if (!Array.isArray(records) || !records.length) fail('NOTHING_TO_SAVE', 'There are no readings to save.');
      if (records.length > MAX_ROWS) fail('TOO_MANY_ROWS', 'That is more readings than one import accepts. Split the file by date range.');
      const guardianId = await guardian();

      let consent = consentId;
      if (scope === 'child_athlete') {
        // Resolved once per import, not once per row: a release that lapses mid-import is not a
        // situation worth modelling, and forty lookups for one answer is not worth the round trips.
        if (!consent) {
          const live = await findLiveConsent(client, athlete);
          if (!live) fail('NO_LIVE_CONSENT', 'There is no live biometric release on file for this athlete. Record one before importing a body composition result.');
          consent = live.id;
        }
      } else if (consent) {
        fail('INVALID_SCOPE', 'An adult reference is not imported under a child release.');
      }

      const results = [];
      for (const record of records) {
        if (record?.schema !== 'PP_BODY_COMPOSITION_REFERENCE_V1' || record?.origin !== 'external_measurement') {
          results.push({ recordId: record?.recordId ?? null, outcome: 'refused', reason: 'That is not an external measurement record.' });
          continue;
        }
        const row = {
          record_id: record.recordId,
          subject_reference: subjectId,
          subject_scope: scope,
          athlete_id: athlete,
          guardian_id: guardianId,
          consent_id: consent,
          team_id: null,
          source_class: record.sourceClass,
          method_label: record.methodLabel ?? null,
          device_manufacturer: record.device?.manufacturer ?? null,
          device_model: record.device?.model ?? null,
          device_software_version: record.device?.softwareVersion ?? null,
          facility: record.device?.facility ?? null,
          operator: record.device?.operator ?? null,
          originating_app: record.device?.originatingApp ?? null,
          source_record_id: record.sourceRecordId ?? null,
          measured_at: record.measuredAt,
          saved_at: record.savedAt,
          retention_until: record.retentionUntil,
          record: clone(record),
        };
        const response = await client.from(TABLE).insert(row).select('id,record_id').maybeSingle();
        if (response?.error) results.push({ recordId: record.recordId, measuredAt: record.measuredAt, ...readDbError(response.error) });
        else results.push({ recordId: record.recordId, measuredAt: record.measuredAt, id: response?.data?.id ?? null, outcome: 'saved' });
      }
      return Object.freeze(results.map(Object.freeze));
    },

    async list() {
      const response = await scoped(client.from(TABLE).select('id,record_id,measured_at,source_class,record'))
        .order('measured_at', { ascending: false }).limit(MAX_ROWS);
      if (response?.error) fail('READ_FAILED', response.error.message || 'Could not read the imported measurements.');
      const rows = response?.data;
      if (rows == null) return [];
      if (!Array.isArray(rows)) fail('READ_FAILED', 'Supabase returned an unusable history.');
      return Object.freeze(rows.map(row => Object.freeze({ id: row.id, recordId: row.record_id, measuredAt: row.measured_at, sourceClass: row.source_class, record: row.record ? clone(row.record) : null })));
    },

    async remove(id) {
      const response = await scoped(client.from(TABLE).delete()).eq('id', uuid(id, 'id')).select('id');
      if (response?.error) fail('DELETE_FAILED', response.error.message || 'Could not delete that measurement.');
      return Array.isArray(response?.data) && response.data.length === 1;
    },

    /* Attach the document a transcription came from.
     *
     * The bytes go to a private bucket under the record's own id, and only the key is stored on
     * the row. A PDF inside the JSON would drag a name, a date of birth and a referring physician
     * into every export and audit entry that ever touched the record.
     */
    async attachReport(recordUuid, file) {
      const id = uuid(recordUuid, 'recordUuid');
      const type = file?.type;
      if (!ATTACHMENT_TYPES[type]) {
        fail('UNSUPPORTED_ATTACHMENT', 'A report can be a PDF, a JPEG or PNG photograph of the printout, or a CSV. That file is ' + (type || 'of an unknown type') + '.');
      }
      if (!Number.isFinite(file?.size) || file.size <= 0) fail('UNSUPPORTED_ATTACHMENT', 'That file is empty.');
      if (file.size > MAX_ATTACHMENT_BYTES) fail('ATTACHMENT_TOO_LARGE', 'That file is larger than 20 MB. Photograph the page rather than scanning it at full resolution.');

      // The name the person's file had is not kept. It is routinely the patient's name.
      const storageKey = id + '/report.' + ATTACHMENT_TYPES[type];
      const upload = await client.storage.from(BUCKET).upload(storageKey, file, { contentType: type, upsert: false });
      if (upload?.error) {
        const message = String(upload.error.message || '');
        if (/exists|duplicate/i.test(message)) fail('ATTACHMENT_EXISTS', 'This record already has a report attached. Delete the record and import it again to replace the document.');
        fail('ATTACHMENT_UPLOAD', message || 'The report could not be uploaded.');
      }
      const response = await client.from(ATTACHMENTS)
        .insert({ record_uuid: id, storage_key: storageKey, content_type: type, verification_status: 'unverified' })
        .select('id,verification_status').maybeSingle();
      if (response?.error) {
        // The row is what makes the object reachable and sweepable. An object with no row is an
        // orphan nothing will ever delete, so it goes back out rather than being left behind.
        await client.storage.from(BUCKET).remove([storageKey]).catch(() => {});
        fail('ATTACHMENT_RECORD', 'The report was uploaded but could not be recorded, so it was removed again: '
          + (response.error.message || 'Supabase rejected the attachment row.'));
      }
      return Object.freeze({ id: response?.data?.id ?? null, storageKey, contentType: type, verification: response?.data?.verification_status ?? 'unverified' });
    },
  });
}

/* What to tell someone after a save, in one place.
 *
 * "Already had it" is separated from "saved" and from "refused" because collapsing the first two
 * would make a re-import look like it added forty readings, and collapsing the last two would
 * make a refusal look like a success.
 */
export function summarizeSave(results) {
  const saved = results.filter(r => r.outcome === 'saved').length;
  const already = results.filter(r => r.outcome === 'already_present').length;
  const refused = results.filter(r => r.outcome === 'refused');
  const parts = [];
  if (saved) parts.push(saved + (saved === 1 ? ' reading added' : ' readings added'));
  if (already) parts.push(already + (already === 1 ? ' was already here' : ' were already here'));
  if (refused.length) parts.push(refused.length + (refused.length === 1 ? ' was refused' : ' were refused'));
  return Object.freeze({
    saved, already, refused: refused.length,
    // The row a report can be attached to. Only meaningful when exactly one reading was added:
    // a document belongs to the reading it backs, and a forty-row export has no single one.
    firstSavedId: saved === 1 ? (results.find(r => r.outcome === 'saved')?.id ?? null) : null,
    reasons: Object.freeze([...new Set(refused.map(r => r.reason))]),
    tone: refused.length ? (saved ? 'warning' : 'error') : 'ok',
    text: parts.length ? parts.join(', ') + '.' : 'Nothing to save.',
  });
}
