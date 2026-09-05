// notify-trainer-review — tells a Pro Trainer applicant that a review decision landed.
//
// Before this, "Request more info" wrote a note into trainer_review_actions (an
// admin-only table) and set the status to needs_info. The applicant was shown generic
// copy, never told what was wrong, and only found out anything by happening to open the
// app. The queue stalled on people who had no idea they'd been asked for something.
//
// Mirrors notify-booking: verify the CALLER, look up the recipient's push
// subscriptions with the service role, send, and reap dead endpoints.
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Deliberately vague about *why* on the negative outcomes. A push notification lands on
// a lock screen that other people can read; the detail belongs behind the login.
const MSGS: Record<string, [string, string]> = {
  needs_info:  ['We need one more thing', 'Open Parent Playbook to see what to update.'],
  approved:    ['You\'re approved 🎉', 'Your trainer profile is live. Next: services and payouts.'],
  reinstated:  ['Your profile is live again', 'Your listing has been reinstated.'],
  rejected:    ['Application update', 'There\'s an update on your application.'],
  suspended:   ['Your profile is paused', 'Your listing is temporarily unlisted.'],
};

// The PUBLISHABLE key, not the legacy anon JWT.
//
// SUPABASE_ANON_KEY is auto-injected and holds the legacy anon JWT — the same key
// the browser app stopped using. Reading it here is what kept that key alive and
// blocked disabling it. Both keys do the identical job in this file: they create a
// client that carries the CALLER's Authorization header so RLS evaluates as that
// user. Neither grants anything on its own.
//
// Hardcoding is safe and deliberate: the publishable key is public by design and
// already ships in js/core.js to every browser. The env lookup comes first so a
// future rotation needs a secret change, not a redeploy.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') || '';
    const uc = createClient(url, PUBLISHABLE, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Only an admin may announce a review decision. Checked with the service role
    // against app_admins rather than trusting anything the caller sent.
    const { data: adminRow } = await svc.from('app_admins')
      .select('guardian_id').eq('guardian_id', user.id).maybeSingle();
    if (!adminRow) return json({ error: 'forbidden' }, 403);

    const { trainer_id, kind } = await req.json();
    if (!trainer_id || !MSGS[kind]) return json({ error: 'bad request' }, 400);

    // Confirm the trainer exists before pushing at whatever id we were handed.
    const { data: prof } = await svc.from('trainer_profiles')
      .select('id').eq('id', trainer_id).maybeSingle();
    if (!prof) return json({ error: 'not found' }, 404);

    const [title, bodyTxt] = MSGS[kind];
    const { data: subs } = await svc.from('push_subscriptions').select('*').eq('user_id', trainer_id);

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:support@chimaura.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    let sent = 0;
    for (const s of (subs || [])) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body: bodyTxt, url: '/' }),
        );
        sent++;
      } catch (err) {
        const code = (err as any)?.statusCode;
        if (code === 404 || code === 410) await svc.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
});
