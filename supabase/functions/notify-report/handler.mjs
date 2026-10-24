// notify-report — emails support the moment a parent reports a coach's message.
//
// "Report this message" (js/screen-coach.js) writes a row to coach_update_reports and nothing else, so a report sat
// in Account & settings → Team Connect safety until an admin happened to open it. App Review is told reports are
// reviewed within 24 hours, which only holds if someone hears about each one. Two callers, one code path: the
// insert trigger in supabase/migrations/20261007120000_report_support_alert.sql posts the new report's id, and a
// cron job posts {} every 15 minutes to send anything the trigger's request missed. A report is alerted exactly once:
// support_alerted_at is stamped only after Resend accepts the email, so a failed send is retried by the next sweep.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/notify-report-function.test.cjs). Called by the database, never by a person.

import { isScheduler, bearerOf } from '../_shared/push-policy.mjs';

export const SUPPORT_EMAIL = 'support@playbookbp.com';
export const REVIEW_HOURS = 24;
export const BATCH = 20;
const DEFAULT_FROM = 'Parent Playbook <hello@send.playbookbp.com>';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The review deadline in US Eastern, the timezone the rest of the product schedules in.
export function reviewBy(createdAt) {
  const due = new Date(new Date(createdAt).getTime() + REVIEW_HOURS * 3600000);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(due);
}

// The subject names no child and quotes nothing: it shows in a notification on whatever device reads the inbox.
export function reportEmail({ report, update, athleteName, senderName }) {
  const due = reviewBy(report.created_at);
  const subject = `Report to review by ${due}: Team Connect message`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#16221F">
<p><b>A parent reported a coach's message.</b> Review it by <b>${esc(due)}</b> (24 hours from the report).</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:4px 12px 4px 0;color:#5C6B66">Athlete</td><td>${esc(athleteName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5C6B66">Coach</td><td>${esc(senderName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5C6B66">Reported</td><td>${esc(new Date(report.created_at).toISOString())}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5C6B66">Auto-flagged too</td><td>${update && update.auto_flagged ? 'Yes' : 'No'}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5C6B66">Report ID</td><td>${esc(report.id)}</td></tr>
</table>
<p style="margin:16px 0 4px;color:#5C6B66">The parent's reason</p>
<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #E4EAE7;white-space:pre-wrap">${esc(report.reason)}</blockquote>
<p style="margin:16px 0 4px;color:#5C6B66">The reported message</p>
<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #E4EAE7;white-space:pre-wrap">${update ? esc(update.body) : '<i>The message has since been deleted.</i>'}</blockquote>
<p style="margin-top:20px">Review and close it in the app: sign in as an admin, then <b>Profile → Account &amp; settings → Team Connect safety</b>. If the message suggests a child is at risk, contact the authorities first.</p>
</div>`;
  return { subject, html };
}

export function createNotifyReportHandler({ db, fetchImpl = globalThis.fetch, env = {}, now = () => new Date() } = {}) {
  if (!db || typeof fetchImpl !== 'function') throw new TypeError('createNotifyReportHandler needs db and fetchImpl');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (!isScheduler(bearerOf(req), env.SERVICE_KEY)) return json({ error: 'forbidden' }, 403);
      if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY is not set, so report alerts cannot be emailed', sent: 0 }, 503);

      let body = {};
      try { body = await req.json(); } catch { body = {}; }
      const reportId = typeof body?.report_id === 'string' ? body.report_id : null;

      // Open reports nobody has been told about yet, oldest first, so a backlog clears in the order it arrived.
      let query = db.from('coach_update_reports').select('id, update_id, reason, status, created_at, support_alerted_at')
        .is('support_alerted_at', null).eq('status', 'open');
      if (reportId) query = query.eq('id', reportId);
      const { data: reports, error } = await query.order('created_at', { ascending: true }).limit(BATCH);
      if (error) return json({ error: 'could not read reports' }, 500);
      if (!reports || !reports.length) return json({ ok: true, pending: 0, sent: 0 });

      const updateIds = [...new Set(reports.map(r => r.update_id))];
      const { data: updates } = await db.from('coach_updates').select('id, athlete_id, sender_id, body, auto_flagged').in('id', updateIds);
      const updateById = new Map((updates || []).map(u => [u.id, u]));
      const athleteIds = [...new Set((updates || []).map(u => u.athlete_id))];
      const senderIds = [...new Set((updates || []).map(u => u.sender_id))];
      const { data: athletes } = athleteIds.length ? await db.from('athletes').select('id, first_name').in('id', athleteIds) : { data: [] };
      const { data: senders } = senderIds.length ? await db.from('guardians').select('id, display_name').in('id', senderIds) : { data: [] };
      const athleteName = id => (athletes || []).find(a => a.id === id)?.first_name || 'Unknown athlete';
      const senderName = id => ((senders || []).find(s => s.id === id)?.display_name || '').trim() || 'Unknown coach';

      const to = env.SUPPORT_EMAIL || SUPPORT_EMAIL;
      const from = env.ALERT_FROM || DEFAULT_FROM;
      const tally = { ok: true, pending: reports.length, sent: 0, failures: [] };
      for (const report of reports) {
        const update = updateById.get(report.update_id) || null;
        const { subject, html } = reportEmail({
          report, update,
          athleteName: update ? athleteName(update.athlete_id) : 'Unknown athlete',
          senderName: update ? senderName(update.sender_id) : 'Unknown coach',
        });
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
        if (!response.ok) {
          tally.failures.push({ report_id: report.id, status: response.status });
          continue;
        }
        await db.from('coach_update_reports').update({ support_alerted_at: now().toISOString() }).eq('id', report.id);
        tally.sent++;
      }
      return json(tally, tally.failures.length && !tally.sent ? 502 : 200);
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
