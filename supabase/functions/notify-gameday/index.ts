// notify-gameday — the night before a game.
//
// The second of exactly two notifications this app sends. The design argument for
// splitting the permission ask in two is that nobody grants push to a vague request,
// but they will for a game-day reminder — so this one has to actually exist, or the
// toggle in Account & settings is a lie.
//
// Deliberately narrow: it looks at athlete_sports.game_day, checks the athlete is in
// season, honours notification_prefs.game_day, and sends one line. It does NOT
// recompute the plan — buildProgram lives in the browser and a second implementation
// here would drift.
//
// Runs nightly from pg_cron. The message is about TOMORROW.
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Same two accepted proofs as notify-weekly — see the comment there for why the JWT
// claim is safe to read (verify_jwt has already checked the signature).
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

// Mon=0 … Sun=6, matching DAY_LABELS in program.js. Everything in this app uses that
// convention; JS getUTCDay() uses Sun=0, and mixing them shifts every game by a day.
function mondayFirst(d: Date): number { return (d.getUTCDay() + 6) % 7; }
function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  try {
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!isScheduler(bearer)) return json({ error: 'forbidden' }, 403);

    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') === '1';
    // ?for=YYYY-MM-DD pins "tomorrow" so this can be tested on a day that isn't one.
    const forParam = url.searchParams.get('for');

    const now = new Date();
    const tomorrow = forParam ? new Date(forParam + 'T00:00:00Z')
                              : new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (isNaN(tomorrow.getTime())) return json({ error: 'bad ?for= date' }, 400);
    const tIdx = mondayFirst(tomorrow);
    const tIso = isoDay(tomorrow);

    const svc = createClient(URL_, SERVICE);

    // Sports whose weekly game day falls tomorrow.
    const { data: sports, error: spErr } = await svc
      .from('athlete_sports')
      .select('athlete_id, sport_key, game_day, season_start, season_end, season_state')
      .eq('game_day', tIdx);
    if (spErr) return json({ error: spErr.message }, 500);
    if (!sports || !sports.length) return json({ ok: true, tomorrow: tIso, matches: 0, sent: 0 });

    // A weekly game day means nothing out of season — the same rule buildProgram applies.
    const inPlay = sports.filter((s: any) => {
      if (s.season_state === 'offseason' || s.season_state === 'between_sports') return false;
      if (s.season_start && tIso < s.season_start) return false;
      if (s.season_end && tIso > s.season_end) return false;
      return true;
    });
    if (!inPlay.length) return json({ ok: true, tomorrow: tIso, matches: sports.length, inSeason: 0, sent: 0 });

    // A cancellation logged for tomorrow removes it.
    const athleteIds = [...new Set(inPlay.map((s: any) => s.athlete_id))];
    const { data: exc } = await svc.from('schedule_exceptions')
      .select('athlete_id').eq('on_date', tIso).in('athlete_id', athleteIds);
    const cancelled = new Set((exc || []).map((e: any) => e.athlete_id));
    const playing = athleteIds.filter((id) => !cancelled.has(id));
    if (!playing.length) return json({ ok: true, tomorrow: tIso, allCancelled: true, sent: 0 });

    // athlete -> family -> guardians -> their subscriptions
    const { data: kids } = await svc.from('athletes')
      .select('id, first_name, family_id').in('id', playing);
    const famIds = [...new Set((kids || []).map((k: any) => k.family_id))];
    const { data: mem } = famIds.length
      ? await svc.from('family_members').select('guardian_id, family_id').in('family_id', famIds)
      : { data: [] as any[] };
    const guardianIds = [...new Set((mem || []).map((m: any) => m.guardian_id))];
    if (!guardianIds.length) return json({ ok: true, tomorrow: tIso, sent: 0, note: 'no guardians' });

    const { data: subs } = await svc.from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth').in('user_id', guardianIds);
    if (!subs || !subs.length) return json({ ok: true, tomorrow: tIso, subscriptions: 0, sent: 0 });

    // A missing prefs row means both types are on — see the table comment.
    const { data: prefs } = await svc.from('notification_prefs')
      .select('guardian_id, game_day').in('guardian_id', guardianIds);
    const optedOut = new Set((prefs || []).filter((p: any) => p.game_day === false).map((p: any) => p.guardian_id));

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
      if (!names.length) return null;
      if (names.length === 1) {
        return [`${names[0]} has a game tomorrow`,
                'Light dinner, early night. Tap for the three things to say on the drive.'];
      }
      const listed = names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return ['Game day tomorrow', `${listed} are playing. Tap for the game-day guidance.`];
    }

    if (!dry) {
      const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
      if (!pub || !priv) return json({ error: 'VAPID keys are not configured for edge functions', sent: 0 }, 500);
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@chimaura.com', pub, priv);
    }

    let sent = 0, skipped = 0, reaped = 0;
    const failures: Array<{ code: number | null; message: string }> = [];
    const preview: Array<{ names: string[]; title: string; body: string }> = [];

    for (const s of subs) {
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
      } catch (err) {
        const code = (err as any)?.statusCode;
        if (code === 404 || code === 410) {
          await svc.from('push_subscriptions').delete().eq('id', s.id);
          reaped++;
        } else {
          // Never swallow this: a total delivery failure and "nobody subscribed" look
          // identical from the outside otherwise.
          failures.push({ code: code ?? null, message: String((err as any)?.body || (err as Error)?.message || err).slice(0, 200) });
        }
      }
    }

    return json({ ok: true, dry, tomorrow: tIso, dayIndex: tIdx,
                  athletes: playing.length, subscriptions: subs.length,
                  sent, skipped, reaped, failures, preview });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
