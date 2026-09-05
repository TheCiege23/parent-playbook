// send-invite-sms — the invite as a text message, which is how these actually travel.
//
// Email was always the polite fiction. A parent inviting a grandmother does it by text,
// and until now the product's answer was "copy this link and paste it into Messages
// yourself" — which is a step, and steps are where invitations die. Sharing was removed
// from this product on purpose (CHANGES-2026-08-13), so the invite IS the distribution;
// making it one tap is the difference between a feature and a thing people use.
//
// Two things make this safe enough to add:
//
//   1. THE NUMBER IS NEVER TAKEN FROM THE REQUEST. It comes off the invite row, which
//      only someone with edit rights on that athlete could have set. Without that rule
//      this endpoint is an open SMS relay wearing a Parent Playbook return address, and
//      the first person to find it would use it for exactly that.
//   2. THE LINK IS NO LONGER SUFFICIENT. SMS is the medium people forward without
//      thinking, so shipping invites over it would have made the weakest part of the
//      product weaker. The confirmation code (issue_invite_code) landed in the same
//      change for that reason, and this function will not send without one.
//
// UNTIL THE SENDER IS REGISTERED this returns 503 and the app falls back to "copy the
// message". US carriers drop A2P traffic from unregistered brands silently — not with an
// error, just into nothing — so a missing config has to fail loudly here rather than
// look like a delivered text nobody received.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// The publishable key, not the legacy anon JWT — same reasoning as send-invite. It only
// creates a client that carries the CALLER's Authorization header so RLS evaluates as
// that user; it grants nothing on its own.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const uc = createClient(url, PUBLISHABLE, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const inviteId = body?.invite_id;
    if (!inviteId) return json({ error: 'invite_id required' }, 400);

    // The code is the one thing that legitimately arrives in the body: it exists only in
    // the caller's hand, because the row keeps a hash of it and nothing else. Bounded to
    // exactly six digits so the request cannot smuggle a paragraph into the message.
    const code = String(body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return json({ error: 'code_required',
        message: 'This text carries a confirmation code, and none was supplied.' }, 400);
    }

    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: inv, error: ie } = await svc.from('athlete_invites')
      .select('id, athlete_id, role, token, invited_phone, created_by, expires_at, accepted_at, revoked_at')
      .eq('id', inviteId).maybeSingle();
    if (ie) return json({ error: ie.message }, 500);
    if (!inv) return json({ error: 'not_found' }, 404);
    if (inv.revoked_at || inv.accepted_at) return json({ error: 'invite is no longer active' }, 409);
    if (!inv.invited_phone) {
      return json({ error: 'no_phone', message: 'This invite has no phone number on it.' }, 400);
    }

    // Authorisation gate. The read above used the service role and bypassed RLS; without
    // this, any signed-in user could make this function text any invite's recipient.
    let ok = false;
    {
      const { data: acc } = await uc.from('athlete_access')
        .select('role').eq('athlete_id', inv.athlete_id).eq('guardian_id', user.id)
        .is('revoked_at', null).limit(1);
      const r = acc && acc[0] ? acc[0].role : null;
      ok = r === 'owner' || r === 'co_parent';
      if (!ok) {
        const { data: ath } = await uc.from('athletes').select('family_id').eq('id', inv.athlete_id).maybeSingle();
        if (ath) {
          const { data: mem } = await uc.from('family_members')
            .select('role').eq('family_id', ath.family_id).eq('guardian_id', user.id).limit(1);
          const mr = mem && mem[0] ? mem[0].role : null;
          ok = mr === 'owner' || mr === 'co_parent';
        }
      }
    }
    if (!ok) return json({ error: 'forbidden' }, 403);

    const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
    // Two ways to authenticate, and the API key pair is the better one: it can be
    // revoked on its own without rotating the account's master credential, which the
    // auth token is. Preferred when both are present.
    const apiKey = Deno.env.get('TWILIO_API_KEY');
    const apiSecret = Deno.env.get('TWILIO_API_SECRET');
    const authTok = Deno.env.get('TWILIO_AUTH_TOKEN');
    const basicUser = apiKey && apiSecret ? apiKey : sid;
    const basicPass = apiKey && apiSecret ? apiSecret : authTok;

    // A Messaging Service is what a registered A2P campaign attaches to, so it wins when
    // both are set; a bare number is the simpler path while testing. TWILIO_PHONE_NUMBER
    // is accepted alongside TWILIO_FROM because that is what the Twilio console calls it,
    // and a variable that has to be renamed to work is a variable that will be set wrong.
    const msid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
    const from = Deno.env.get('TWILIO_FROM') || Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!sid || !basicPass || (!msid && !from)) {
      // Say exactly WHICH piece is missing. "Not configured" sends someone to re-check
      // the three things that are already right.
      const missing = [
        !sid ? 'TWILIO_ACCOUNT_SID' : null,
        !basicPass ? 'TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET)' : null,
        (!msid && !from) ? 'TWILIO_PHONE_NUMBER (or TWILIO_MESSAGING_SERVICE_SID)' : null,
      ].filter(Boolean);
      return json({ error: 'sms_not_configured',
        message: 'The text could not be sent: ' + missing.join(', ') + ' is not set on this '
               + 'Supabase project. Note these are EDGE FUNCTION secrets — setting them on '
               + 'the web host does nothing, because this code does not run there. '
               + 'The link and code still work: copy the message and send it yourself.',
        missing }, 503);
    }

    const [{ data: ath }, { data: guardian }] = await Promise.all([
      svc.from('athletes').select('first_name').eq('id', inv.athlete_id).maybeSingle(),
      svc.from('guardians').select('display_name').eq('id', inv.created_by).maybeSingle(),
    ]);
    const inviterFirst = ((guardian?.display_name || '').trim() || 'A parent').split(/\s+/)[0];
    const athleteFirst = ath?.first_name || 'their athlete';
    const siteUrl = Deno.env.get('SITE_URL') || 'https://playbook.chimaura.com';
    const inviteUrl = siteUrl + '/?invite=' + encodeURIComponent(inv.token);

    // Kept close to two segments. The opt-out line is not optional decoration — US
    // carriers require it on A2P traffic, and its absence is a reason campaigns get
    // filtered rather than delivered.
    const text =
      `${inviterFirst} invited you to follow ${athleteFirst}'s season on Parent Playbook.\n\n`
      + `${inviteUrl}\n\nYour code: ${code}\n\n`
      + `Reply STOP to opt out.`;

    const form = new URLSearchParams();
    form.set('To', inv.invited_phone);
    if (msid) form.set('MessagingServiceSid', msid); else form.set('From', from!);
    form.set('Body', text);

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        // The URL always carries the ACCOUNT sid; only the credential pair changes.
        'Authorization': 'Basic ' + btoa(`${basicUser}:${basicPass}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Never swallow this. A silent failure looks identical to a delivered text, and
      // the parent sits waiting for a grandmother who never got anything.
      return json({ error: 'send_failed', status: res.status,
        message: out?.message || 'The SMS gateway rejected it.', detail: out }, 502);
    }

    await svc.from('athlete_invites').update({ sent_via: 'text' }).eq('id', inv.id);
    return json({ ok: true, sid: out?.sid ?? null });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
