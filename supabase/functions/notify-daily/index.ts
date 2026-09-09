// notify-daily — the afternoon nudge. 4:12pm: after school, before dinner.
//
// Design handoff, platform §6. The rule that shapes this whole function is "nothing on
// rest days — silence is the message". Whether today is a rest day is decided by
// buildProgram, which lives in the BROWSER. Reimplementing it here would give two
// engines that drift, and the nudge would eventually describe a week the app does not
// show.
//
// So this function computes nothing. The client publishes which day indexes are
// nudge-able into week_plan_days after every week render, and this reads it. If a
// household has not opened the app this week there is no row, and they get silence —
// which is the correct outcome, not a bug.
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function isScheduler(bearer: string): boolean {
  if (!bearer) return false;
  if (SERVICE && bearer === SERVICE) return true;
  const parts = bearer.split('.');
  if (parts.length !== 3) return false;
  try {
    const pad = (s: string) => s + '='.repeat((4 - (s.length % 4)) % 4);
    const payload = JSON.parse(atob(pad(parts[1].replace(/-/g, '+').replace(/_/g, '/'))));
    return payload?.role === 'service_role';
  } catch (_) {
    return false;
  }
}

// ---- send policy (shared with notify-weekly / notify-gameday) --------------------
const WEEKLY_CAP = 4;
const QUIET_FROM = 21;
const QUIET_TO   = 7;
const APP_TZ = 'America/New_York';
function localHour(): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour: 'numeric', hour12: false })
    .format(new Date());
  return parseInt(s, 10);
}
function inQuietHours(): boolean {
  const h = localHour();
  return h >= QUIET_FROM || h < QUIET_TO;
}
async function overCap(svc: any, guardianIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!guardianIds.length) return out;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await svc.from('notification_log')
    .select('guardian_id').in('guardian_id', guardianIds).gte('sent_at', since);
  if (error) { console.error('cap check failed', error); return out; }   // fail OPEN
  const counts: Record<string, number> = {};
  for (const r of (data || [])) counts[r.guardian_id] = (counts[r.guardian_id] || 0) + 1;
  for (const id of guardianIds) if ((counts[id] || 0) >= WEEKLY_CAP) out.add(id);
  return out;
}
async function logSend(svc: any, guardianId: string, kind: string) {
  const { error } = await svc.from('notification_log').insert({ guardian_id: guardianId, kind });
  if (error) console.error('notification_log insert failed', error);
}

// Mon=0 … Sun=6, matching DAY_LABELS in program.js.
function mondayFirst(d: Date): number { return (d.getUTCDay() + 6) % 7; }
function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - mondayFirst(x));
  return isoDay(x);
}

Deno.serve(async (req) => {
  try {
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!isScheduler(bearer)) return json({ error: 'forbidden' }, 403);

    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') === '1';
    const force = url.searchParams.get('force') === '1';
    if (!dry && !force && inQuietHours()) return json({ ok: true, skipped: 'quiet_hours', hour: localHour() });

    const forParam = url.searchParams.get('for');
    const today = forParam ? new Date(forParam + 'T12:00:00Z') : new Date();
    if (isNaN(today.getTime())) return json({ error: 'bad ?for= date' }, 400);
    const dayIdx = mondayFirst(today);
    const weekStart = mondayOf(today);

    const svc = createClient(URL_, SERVICE);

    // Whose plan has something to do TODAY. No row = they haven't opened the app this
    // week = silence, which is correct.
    const { data: plans, error: pe } = await svc.from('week_plan_days')
      .select('athlete_id, nudge_days').eq('week_start', weekStart);
    if (pe) return json({ error: pe.message }, 500);
    const due = (plans || []).filter((p: any) => Array.isArray(p.nudge_days) && p.nudge_days.includes(dayIdx));
    if (!due.length) return json({ ok: true, weekStart, dayIdx, plans: (plans || []).length, due: 0, sent: 0 });

    const athleteIds = due.map((p: any) => p.athlete_id);

    // A session already ticked off today is not something to nudge about.
    const { data: done } = await svc.from('sessions')
      .select('athlete_id').eq('done_on', isoDay(today)).in('athlete_id', athleteIds);
    const doneSet = new Set((done || []).map((d: any) => d.athlete_id));
    const pending = athleteIds.filter((id: string) => !doneSet.has(id));
    if (!pending.length) return json({ ok: true, weekStart, dayIdx, due: due.length, allDone: true, sent: 0 });

    const { data: kids } = await svc.from('athletes')
      .select('id, first_name, family_id').in('id', pending);
    const famIds = [...new Set((kids || []).map((k: any) => k.family_id))];
    const { data: mem } = famIds.length
      ? await svc.from('family_members').select('guardian_id, family_id').in('family_id', famIds)
      : { data: [] as any[] };
    const guardianIds = [...new Set((mem || []).map((m: any) => m.guardian_id))];
    if (!guardianIds.length) return json({ ok: true, sent: 0, note: 'no guardians' });

    const { data: subs } = await svc.from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth').in('user_id', guardianIds);
    if (!subs || !subs.length) return json({ ok: true, subscriptions: 0, sent: 0 });

    // The daily nudge rides on the weekly preference: a parent who turned the week
    // ahead off is telling us they do not want the routine reminders.
    const { data: prefs } = await svc.from('notification_prefs')
      .select('guardian_id, weekly').in('guardian_id', guardianIds);
    const optedOut = new Set((prefs || []).filter((p: any) => p.weekly === false).map((p: any) => p.guardian_id));

    const kidsByFamily = new Map<string, string[]>();
    for (const k of (kids || [])) {
      const list = kidsByFamily.get(k.family_id) || [];
      if (k.first_name) list.push(k.first_name);
      kidsByFamily.set(k.family_id, list);
    }
    const namesByUser = new Map<string, string[]>();
    for (const m of (mem || [])) {
      const list = namesByUser.get(m.guardian_id) || [];
      for (const n of (kidsByFamily.get(m.family_id) || [])) if (!list.includes(n)) list.push(n);
      namesByUser.set(m.guardian_id, list);
    }

    // No guilt, no streak warnings, no comparison. Screen 4 of the design is an
    // explicit do-not-build list and this is the message it is guarding.
    function messageFor(names: string[]): [string, string] | null {
      if (!names.length) return null;
      if (names.length === 1) return [`${names[0]} has something short today`, 'Tap to see it — it takes about ten minutes.'];
      const listed = names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return ['Something short today', `${listed} both have a session. Tap to see them.`];
    }

    if (!dry) {
      const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
      if (!pub || !priv) return json({ error: 'VAPID keys are not configured for edge functions', sent: 0 }, 500);
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@chimaura.com', pub, priv);
    }

    const capped = await overCap(svc, [...new Set(subs.map((s: any) => s.user_id))]);
    let sent = 0, skipped = 0, reaped = 0, cappedOut = 0;
    const failures: Array<{ code: number | null; message: string }> = [];
    const preview: Array<{ names: string[]; title: string; body: string }> = [];

    for (const s of subs) {
      if (capped.has(s.user_id)) { cappedOut++; continue; }
      if (optedOut.has(s.user_id)) { skipped++; continue; }
      const msg = messageFor(namesByUser.get(s.user_id) || []);
      if (!msg) { skipped++; continue; }
      const [title, body] = msg;
      if (dry) { preview.push({ names: namesByUser.get(s.user_id) || [], title, body }); sent++; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url: '/#week' }),
        );
        sent++;
        await logSend(svc, s.user_id, 'daily');
      } catch (err) {
        const code = (err as any)?.statusCode;
        if (code === 404 || code === 410) {
          await svc.from('push_subscriptions').delete().eq('id', s.id);
          reaped++;
        } else {
          failures.push({ code: code ?? null, message: String((err as any)?.body || (err as Error)?.message || err).slice(0, 200) });
        }
      }
    }

    return json({ ok: true, dry, weekStart, dayIdx, due: due.length, pending: pending.length,
                  subscriptions: subs.length, sent, skipped, reaped, cappedOut, failures, preview });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
