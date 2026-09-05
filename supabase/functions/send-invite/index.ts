// send-invite — the only growth mechanism the product has.
//
// Sharing was removed (CHANGES-2026-08-13), so an invite IS the distribution. Until now
// a parent generated a link and copied it into a text message by hand; anyone who
// wanted to invite a grandparent had to be the kind of person who does that.
//
// Verifies the CALLER can edit the athlete, not merely that they are signed in, then
// sends with the service role. It never trusts an address from the request body — the
// recipient is whatever is stored on the invite row, which only an editor could set.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const ROLE_LABEL: Record<string, string> = {
  family_view: 'family view — they can see games, photos and the week, but cannot change anything',
  co_parent: 'co-parent access — they can log games and mark sessions done, but not change your account',
};

// The template is fetched from the site rather than bundled here: it is 7KB of HTML
// whose entire purpose is to be mailed to strangers, so there is nothing to protect,
// and this way you edit the email by redeploying the site — not this function.
const TEMPLATE_URL = (Deno.env.get('SITE_URL') || 'https://playbook.chimaura.com') + '/emails/invite.html';
let TEMPLATE_CACHE: string | null = null;
async function loadTemplate(): Promise<string> {
  if (TEMPLATE_CACHE) return TEMPLATE_CACHE;
  const r = await fetch(TEMPLATE_URL, { redirect: 'follow' });
  if (!r.ok) throw new Error('template fetch failed: ' + r.status);
  const t = await r.text();
  if (!/{{invite_url}}/.test(t)) throw new Error('template at ' + TEMPLATE_URL + ' has no {{invite_url}} — wrong file served');
  TEMPLATE_CACHE = t;
  return t;
}

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
    const auth = req.headers.get('Authorization') || '';
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const uc = createClient(url, PUBLISHABLE, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await uc.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const inviteId = body?.invite_id;
    if (!inviteId) return json({ error: 'invite_id required' }, 400);

    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: inv, error: ie } = await svc.from('athlete_invites')
      .select('id, athlete_id, role, token, invited_email, created_by, expires_at, accepted_at, revoked_at')
      .eq('id', inviteId).maybeSingle();
    if (ie) return json({ error: ie.message }, 500);
    if (!inv) return json({ error: 'not_found' }, 404);
    if (inv.revoked_at || inv.accepted_at) return json({ error: 'invite is no longer active' }, 409);
    if (!inv.invited_email) return json({ error: 'no_email', message: 'This invite has no email address on it.' }, 400);

    // Authorisation gate. The read above used the service role and so bypassed RLS —
    // without this, any signed-in user could mail any invite to its recipient.
    // The user client means RLS applies to everything below.
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

    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) return json({ error: 'email_not_configured',
      message: 'RESEND_API_KEY is not set on this project, so the invite email cannot be sent. The link itself still works — copy it instead.' }, 503);

    const [{ data: ath }, { data: guardian }] = await Promise.all([
      svc.from('athletes').select('first_name, birthdate').eq('id', inv.athlete_id).maybeSingle(),
      svc.from('guardians').select('display_name').eq('id', inv.created_by).maybeSingle(),
    ]);
    const { data: sp } = await svc.from('athlete_sports')
      .select('sport_key').eq('athlete_id', inv.athlete_id).eq('is_primary', true).maybeSingle();
    const sportRow = sp
      ? (await svc.from('sports').select('name').eq('key', sp.sport_key).maybeSingle()).data
      : null;

    const age = ath?.birthdate
      ? Math.floor((Date.now() - new Date(ath.birthdate).getTime()) / 31557600000)
      : null;
    const inviterFull = (guardian?.display_name || '').trim() || 'A parent';
    const inviterFirst = inviterFull.split(/\s+/)[0];
    const siteUrl = Deno.env.get('SITE_URL') || 'https://playbook.chimaura.com';
    const inviteUrl = siteUrl + '/?invite=' + encodeURIComponent(inv.token);
    const expires = new Date(inv.expires_at).toLocaleDateString('en-US',
      { weekday: 'long', month: 'long', day: 'numeric' });

    const vars: Record<string, string> = {
      athlete_first: esc(ath?.first_name || 'their athlete'),
      athlete_age: age != null ? String(age) : '',
      sport: esc(sportRow?.name || ''),
      inviter_first: esc(inviterFirst),
      inviter_full: esc(inviterFull),
      role_label: esc(ROLE_LABEL[inv.role] || ROLE_LABEL.family_view),
      invite_url: inviteUrl,          // a URL we constructed; escaping would break the href
      expires_human: esc(expires),
    };
    const TEMPLATE = await loadTemplate();
    const html = TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => vars[k] ?? '');

    const subject = inviterFirst + ' wants you to follow ' + (ath?.first_name || 'their athlete') + "'s season";
    const from = Deno.env.get('INVITE_FROM') || 'Parent Playbook <hello@send.chimaura.com>';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [inv.invited_email], subject, html, reply_to: 'support@chimaura.com' }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Never swallow this. A silent failure here looks identical to a delivered email,
      // and the parent sits waiting for a grandparent who never got anything.
      return json({ error: 'send_failed', status: res.status, detail: out }, 502);
    }
    return json({ ok: true, id: out?.id ?? null, to: inv.invited_email });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
