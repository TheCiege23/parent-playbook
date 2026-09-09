// notify-weekly — the Sunday "your week is ready" nudge.
//
// A training app you have to remember to open is a training app you stop opening. This is
// the one message that brings a parent back, so it is deliberately quiet: once a week,
// one line, no badges, no streak-shaming, nothing urgent.
//
// It does NOT recompute the training plan. buildProgram lives in the browser, and
// reimplementing it here would give two engines that drift apart — the message would
// eventually describe a week the app does not show. It says only what it can prove from
// the database: whose plan is ready.
//
// Called by pg_cron, never by a person.
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Is this the scheduler rather than a signed-in parent?
//
// Two accepted proofs, because a project can hold both a legacy JWT service_role key and
// a new-format sb_secret_* key, and the one injected here need not be byte-identical to
// the one an operator stored in Vault:
//   1. the bearer matches the injected service key exactly, or
//   2. the bearer is a JWT whose role claim is service_role.
// (2) is safe because verify_jwt is on: the gateway has ALREADY verified the signature
// before this code runs, so the claims cannot have been forged. We are reading an
// authenticated value, not trusting an unverified assertion.
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

// ---- send policy (design handoff, platform §6) ----------------------------------
// Four messages a week, maximum. Nothing between 9pm and 7am. These are enforced here
// rather than trusted to the cron schedule, because a schedule change is one click and
// a parent who gets pushed at 11pm never turns notifications back on.
const WEEKLY_CAP = 4;
const QUIET_FROM = 21;   // 9pm
const QUIET_TO   = 7;    // 7am

// The household timezone isn't stored, so this uses America/New_York — every current
// user is in Bergenfield, NJ. Revisit before anyone outside US Eastern signs up.
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

// Guardians who have already had WEEKLY_CAP messages in the last seven days.
async function overCap(svc: any, guardianIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!guardianIds.length) return out;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await svc.from('notification_log')
    .select('guardian_id').in('guardian_id', guardianIds).gte('sent_at', since);
  if (error) { console.error('cap check failed', error); return out; }   // fail OPEN, never silently mute
  const counts: Record<string, number> = {};
  for (const r of (data || [])) counts[r.guardian_id] = (counts[r.guardian_id] || 0) + 1;
  for (const id of guardianIds) if ((counts[id] || 0) >= WEEKLY_CAP) out.add(id);
  return out;
}
async function logSend(svc: any, guardianId: string, kind: string) {
  const { error } = await svc.from('notification_log').insert({ guardian_id: guardianId, kind });
  if (error) console.error('notification_log insert failed', error);   // never block a send on bookkeeping
}

Deno.serve(async (req) => {
  try {
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!isScheduler(bearer)) return json({ error: 'forbidden' }, 403);

    // ?dry=1 reports who would be messaged without sending anything.
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const force = new URL(req.url).searchParams.get('force') === '1';
    if (!dry && !force && inQuietHours()) return json({ ok: true, skipped: 'quiet_hours', hour: localHour() });

    const svc = createClient(URL_, SERVICE);

    const { data: subs, error: subErr } = await svc
      .from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth');
    if (subErr) return json({ error: subErr.message }, 500);
    if (!subs || subs.length === 0) return json({ ok: true, subscriptions: 0, sent: 0 });

    // Which children belong to each subscribed parent. Two hops: guardian -> family -> athletes.
    const userIds = [...new Set(subs.map((s: any) => s.user_id))];
    const { data: mem } = await svc.from('family_members')
      .select('guardian_id, family_id').in('guardian_id', userIds);
    const famIds = [...new Set((mem || []).map((m: any) => m.family_id))];
    const { data: kids } = famIds.length
      ? await svc.from('athletes').select('first_name, family_id').in('family_id', famIds)
      : { data: [] as any[] };

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

    function messageFor(names: string[]): [string, string] | null {
      // Nobody gets nagged about an account they never finished setting up.
      if (names.length === 0) return null;
      if (names.length === 1) return [`${names[0]}'s week is ready`, 'Tap to see this week\'s plan.'];
      const listed = names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return ['This week\'s plans are ready', `${listed} — tap to see them.`];
    }

    // VAPID is only needed to actually send. A dry run should exercise the data path
    // without requiring crypto keys — otherwise the logic cannot be tested until secrets
    // are configured, which is exactly backwards.
    if (!dry) {
      const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
      if (!pub || !priv) {
        return json({ error: 'VAPID keys are not configured for edge functions', sent: 0 }, 500);
      }
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@playbookbp.com', pub, priv);
    }

    const capped = await overCap(svc, [...new Set(subs.map((s: any) => s.user_id))]);
    let sent = 0, skipped = 0, reaped = 0, cappedOut = 0;
    const failures: Array<{ code: number | null; message: string }> = [];
    const preview: Array<{ names: string[]; title: string; body: string }> = [];

    for (const s of subs) {
      if (capped.has(s.user_id)) { cappedOut++; continue; }
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
        await logSend(svc, s.user_id, 'weekly');
      } catch (err) {
        const code = (err as any)?.statusCode;
        // 404/410 mean the browser threw the subscription away — stop pushing at a ghost.
        if (code === 404 || code === 410) {
          await svc.from('push_subscriptions').delete().eq('id', s.id);
          reaped++;
        } else {
          // Anything else is a genuine fault — most often a 403 from a VAPID key that no
          // longer matches the one the subscription was created with. Swallowing it made
          // a total delivery failure look identical to "nobody was subscribed".
          failures.push({ code: code ?? null, message: String((err as any)?.body || (err as Error)?.message || err).slice(0, 200) });
        }
      }
    }

    return json({ ok: true, dry, subscriptions: subs.length, sent, skipped, reaped, cappedOut, failures, preview });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
