// notify-measure — the monthly "stand them against the wall" nudge.
//
// The growth feature is fully built and will sit empty forever without this. A
// percentile needs one height; a percentile CROSSING — the only part a doctor
// actually asks about — needs two readings 180+ days apart. Nobody measures their
// child unprompted, so the trend never accumulates and the best part of the feature
// never fires.
//
// Deliberately monthly, not weekly. Children do not visibly grow in a week, and a
// reminder that arrives before there is anything to see is how a parent learns to
// ignore the app. CDC's own guidance in the app says "once a month is plenty".
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

// ---- send policy, shared with the other three senders ----------------------------
const WEEKLY_CAP = 4;
const QUIET_FROM = 21;
const QUIET_TO   = 7;
const APP_TZ = 'America/New_York';
function localHour(): number {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour: 'numeric', hour12: false })
    .format(new Date()), 10);
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

// This is the LOWEST-priority message the product sends. It is a nice-to-have that
// improves a chart; the other three are about what a child is doing this week. So it
// yields to all of them: if a household is anywhere near the weekly cap, it does not
// go out at all, rather than crowding out a game-day reminder.
const CAP_HEADROOM = 2;   // only send if they've had fewer than 2 messages this week

// Long enough that there is something to see, short enough that two readings inside a
// season can still form a trend.
const STALE_DAYS = 30;

Deno.serve(async (req) => {
  try {
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!isScheduler(bearer)) return json({ error: 'forbidden' }, 403);

    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') === '1';
    const force = url.searchParams.get('force') === '1';
    if (!dry && !force && inQuietHours()) return json({ ok: true, skipped: 'quiet_hours', hour: localHour() });

    const svc = createClient(URL_, SERVICE);

    // Only athletes whose growth read can actually do something with a height: the
    // percentile needs a sex, and CDC's stature reference only spans 2-20 years.
    const { data: kids, error: ke } = await svc.from('athletes')
      .select('id, first_name, family_id, birthdate, sex_at_birth')
      .not('sex_at_birth', 'is', null)
      .not('birthdate', 'is', null);
    if (ke) return json({ error: ke.message }, 500);

    const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString().slice(0, 10);
    const eligible: any[] = [];
    for (const k of (kids || [])) {
      const age = (Date.now() - new Date(k.birthdate + 'T00:00:00').getTime()) / (365.25 * 86400000);
      if (age < 2 || age > 20) continue;                     // outside the CDC reference
      const { data: last } = await svc.from('measurements')
        .select('measured_on').eq('athlete_id', k.id).eq('metric_key', 'height')
        .order('measured_on', { ascending: false }).limit(1);
      const lastOn = last && last[0] ? last[0].measured_on : null;
      // Never measured, or not measured in a month.
      if (!lastOn || lastOn < cutoff) eligible.push({ ...k, lastOn });
    }
    if (!eligible.length) return json({ ok: true, candidates: (kids || []).length, due: 0, sent: 0 });

    const famIds = [...new Set(eligible.map(k => k.family_id))];
    const { data: mem } = await svc.from('family_members')
      .select('guardian_id, family_id, role').in('family_id', famIds);
    // Only people who can actually write a measurement. Nudging family view to do
    // something RLS will refuse is worse than staying quiet.
    const writers = (mem || []).filter((m: any) => m.role === 'owner' || m.role === 'co_parent');
    const guardianIds = [...new Set(writers.map((m: any) => m.guardian_id))];
    if (!guardianIds.length) return json({ ok: true, due: eligible.length, sent: 0, note: 'no writers' });

    const { data: subs } = await svc.from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth').in('user_id', guardianIds);
    if (!subs || !subs.length) return json({ ok: true, due: eligible.length, subscriptions: 0, sent: 0 });

    // Rides the weekly preference: someone who turned the routine reminders off is
    // telling us they do not want this class of message either.
    const { data: prefs } = await svc.from('notification_prefs')
      .select('guardian_id, weekly').in('guardian_id', guardianIds);
    const optedOut = new Set((prefs || []).filter((p: any) => p.weekly === false).map((p: any) => p.guardian_id));

    const kidsByFamily = new Map<string, any[]>();
    for (const k of eligible) {
      const l = kidsByFamily.get(k.family_id) || [];
      l.push(k); kidsByFamily.set(k.family_id, l);
    }
    const namesByUser = new Map<string, string[]>();
    for (const m of writers) {
      const l = namesByUser.get(m.guardian_id) || [];
      for (const k of (kidsByFamily.get(m.family_id) || []))
        if (k.first_name && !l.includes(k.first_name)) l.push(k.first_name);
      namesByUser.set(m.guardian_id, l);
    }

    // No guilt, no streak, no "you haven't...". It is a two-minute job with a reason
    // attached, and the reason is the honest one: one number is not a trend.
    function messageFor(names: string[]): [string, string] | null {
      if (!names.length) return null;
      if (names.length === 1)
        return [`Time to measure ${names[0]}?`, 'Takes a minute against a door frame. Two readings is what makes a trend.'];
      const listed = names.length === 2 ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return ['Time for a measure-up?', `${listed} are both due. A minute each against a door frame.`];
    }

    if (!dry) {
      const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
      if (!pub || !priv) return json({ error: 'VAPID keys are not configured', sent: 0 }, 500);
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@chimaura.com', pub, priv);
    }

    // Headroom check rather than the plain cap — see CAP_HEADROOM.
    const uniqueUsers = [...new Set(subs.map((s: any) => s.user_id))];
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recent } = await svc.from('notification_log')
      .select('guardian_id').in('guardian_id', uniqueUsers).gte('sent_at', since);
    const weekCount: Record<string, number> = {};
    for (const r of (recent || [])) weekCount[r.guardian_id] = (weekCount[r.guardian_id] || 0) + 1;

    let sent = 0, skipped = 0, reaped = 0, yielded = 0;
    const failures: Array<{ code: number | null; message: string }> = [];
    const preview: Array<{ names: string[]; title: string; body: string }> = [];

    for (const s of subs) {
      if ((weekCount[s.user_id] || 0) >= CAP_HEADROOM) { yielded++; continue; }
      if (optedOut.has(s.user_id)) { skipped++; continue; }
      const msg = messageFor(namesByUser.get(s.user_id) || []);
      if (!msg) { skipped++; continue; }
      const [title, body] = msg;
      if (dry) { preview.push({ names: namesByUser.get(s.user_id) || [], title, body }); sent++; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url: '/#growth' }),
        );
        sent++;
        const { error } = await svc.from('notification_log').insert({ guardian_id: s.user_id, kind: 'measure' });
        if (error) console.error('notification_log insert failed', error);
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

    return json({ ok: true, dry, candidates: (kids || []).length, due: eligible.length,
                  subscriptions: subs.length, sent, skipped, yielded, reaped, failures, preview });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
