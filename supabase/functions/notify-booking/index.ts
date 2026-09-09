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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') || '';
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { booking_id, kind } = await req.json();
    const { data: bk } = await svc.from('bookings')
      .select('parent_id,trainer_id,child_shared, services(title), trainer_profiles(display_name)')
      .eq('id', booking_id).maybeSingle();
    if (!bk) return json({ error: 'not found' }, 404);
    if (user.id !== bk.parent_id && user.id !== bk.trainer_id) return json({ error: 'forbidden' }, 403);

    let recipient = (kind === 'new_request' || kind === 'paid') ? bk.trainer_id
      : kind === 'message' ? (user.id === bk.parent_id ? bk.trainer_id : bk.parent_id)
      : bk.parent_id;
    if (recipient === user.id) recipient = (user.id === bk.parent_id) ? bk.trainer_id : bk.parent_id;

    const childName = (bk as any).child_shared?.first_name || 'your athlete';
    const trainerName = (bk as any).trainer_profiles?.display_name || 'the trainer';
    const svcTitle = (bk as any).services?.title || 'a session';
    const msgs: Record<string, [string, string]> = {
      new_request: ['New booking request', childName + ' requested ' + svcTitle],
      confirmed: ['Booking confirmed', trainerName + ' confirmed your session'],
      declined: ['Booking update', trainerName + ' could not take this session'],
      completed: ['Session completed', 'Tap to leave a review for ' + trainerName],
      paid: ['Payment received', 'Payment for ' + svcTitle + ' is complete'],
      message: ['New message', 'You have a new message'],
    };
    const [title, bodyTxt] = msgs[kind] || ['Parent Playbook', 'You have an update'];

    const { data: subs } = await svc.from('push_subscriptions').select('*').eq('user_id', recipient);
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
