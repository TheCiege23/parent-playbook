// send-invite-sms — the invite as a text message, which is how these actually travel.
//
// A parent inviting a grandmother does it by text. Sharing was removed from this product on purpose
// (CHANGES-2026-08-13), so the invite IS the distribution; one tap is the difference between a feature and a thing
// people use. The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/send-invite-sms-function.test.cjs). What makes it safe enough to exist:
//
//   1. THE NUMBER IS NEVER TAKEN FROM THE REQUEST. It comes off the invite row, which only someone with edit rights
//      on that athlete could have set. Otherwise this is an open SMS relay with a Parent Playbook return address.
//   2. THE LINK IS NOT SUFFICIENT. SMS is forwarded without thinking, so the text carries a six-digit confirmation
//      code, and this function will not send without one. The row keeps only a hash of the code, and the code is
//      sent only if it matches that hash, so a text never asks its recipient for digits that cannot open the invite.
//   3. A MISSING SENDER CONFIGURATION FAILS LOUDLY, naming exactly what is missing. US carriers drop traffic from
//      unregistered brands silently, so a misconfiguration must not look like a delivered text.
//   4. Database and runtime error text is not echoed to the caller.

import { callerCanEditAthlete } from '../_shared/invite-access.mjs';
import { inviteCodeMatches } from '../_shared/invite-code.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

const base64 = text => (typeof btoa === 'function' ? btoa(text) : Buffer.from(text).toString('base64'));

export function createSendInviteSmsHandler({ callerClient, db, fetch: fetchImpl = globalThis.fetch, env = {} } = {}) {
  if (typeof callerClient !== 'function' || !db || typeof fetchImpl !== 'function') throw new TypeError('createSendInviteSmsHandler needs callerClient, db and fetch');

  return async function handle(req) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      const auth = req.headers.get('Authorization') || '';
      if (!auth) return json({ error: 'unauthorized' }, 401);
      const caller = callerClient(auth);
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ error: 'unauthorized' }, 401);

      const body = await req.json().catch(() => ({}));
      const inviteId = body?.invite_id;
      if (!inviteId) return json({ error: 'invite_id required' }, 400);

      // The code is the one thing that legitimately arrives in the body, bounded to exactly six digits so the
      // request cannot smuggle a paragraph into the message.
      const code = String(body?.code ?? '').trim();
      if (!/^\d{6}$/.test(code)) return json({ error: 'code_required', message: 'This text carries a confirmation code, and none was supplied.' }, 400);

      const { data: invite, error: inviteError } = await db.from('athlete_invites')
        .select('id, athlete_id, role, scope, token, invited_phone, created_by, expires_at, accepted_at, revoked_at, code_hash')
        .eq('id', inviteId).maybeSingle();
      if (inviteError) return json({ error: 'internal_error' }, 500);
      if (!invite) return json({ error: 'not_found' }, 404);
      if (invite.revoked_at || invite.accepted_at) return json({ error: 'invite is no longer active' }, 409);
      if (!invite.invited_phone) return json({ error: 'no_phone', message: 'This invite has no phone number on it.' }, 400);

      // The read above used the service role and bypassed row-level security. Without this gate any signed-in
      // user could make this function text any invite's recipient.
      if (!(await callerCanEditAthlete(caller, invite.athlete_id, user.id))) return json({ error: 'forbidden' }, 403);

      // After the gate, so only an editor learns whether a code fits.
      if (!(await inviteCodeMatches(code, invite.token, invite.code_hash))) {
        return json({ error: 'code_mismatch', message: 'That is not the code issued for this invite, so the text was not sent.' }, 400);
      }

      const sid = env.TWILIO_ACCOUNT_SID;
      // An API key pair can be revoked on its own without rotating the account's master credential, so it wins
      // when both are set.
      const basicUser = env.TWILIO_API_KEY && env.TWILIO_API_SECRET ? env.TWILIO_API_KEY : sid;
      const basicPass = env.TWILIO_API_KEY && env.TWILIO_API_SECRET ? env.TWILIO_API_SECRET : env.TWILIO_AUTH_TOKEN;
      // A Messaging Service is what a registered A2P campaign attaches to, so it wins over a bare number.
      const messagingService = env.TWILIO_MESSAGING_SERVICE_SID;
      const from = env.TWILIO_FROM || env.TWILIO_PHONE_NUMBER;

      if (!sid || !basicPass || (!messagingService && !from)) {
        const missing = [
          !sid ? 'TWILIO_ACCOUNT_SID' : null,
          !basicPass ? 'TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET)' : null,
          (!messagingService && !from) ? 'TWILIO_PHONE_NUMBER (or TWILIO_MESSAGING_SERVICE_SID)' : null,
        ].filter(Boolean);
        return json({ error: 'sms_not_configured',
          message: 'The text could not be sent: ' + missing.join(', ') + ' is not set on this Supabase project. '
            + 'Note these are EDGE FUNCTION secrets — setting them on the web host does nothing, because this code does not run there. '
            + 'The link and code still work: copy the message and send it yourself.',
          missing }, 503);
      }

      const [{ data: athlete }, { data: guardian }] = await Promise.all([
        db.from('athletes').select('first_name').eq('id', invite.athlete_id).maybeSingle(),
        db.from('guardians').select('display_name').eq('id', invite.created_by).maybeSingle(),
      ]);
      // An account with no display name has nobody to name. The stand-in "A parent" cut to its first word read
      // "A invited you…", so such a text says "You're invited" instead.
      const inviterFirst = (guardian?.display_name || '').trim().split(/\s+/)[0];
      const opener = inviterFirst ? `${inviterFirst} invited you` : "You're invited";
      const athleteFirst = athlete?.first_name || 'their athlete';
      const familyWide = invite.scope === 'family' && invite.role !== 'coach';
      const siteUrl = env.SITE_URL || 'https://playbookbp.com';
      const inviteUrl = siteUrl + '/?invite=' + encodeURIComponent(invite.token);

      // Kept close to two segments. The opt-out line is required by US carriers on A2P traffic.
      const text =
        `${familyWide
          ? `${opener} to follow the family's sports journey on Parent Playbook.`
          : `${opener} to follow ${athleteFirst}'s season on Parent Playbook.`}\n\n`
        + `${inviteUrl}\n\nYour code: ${code}\n\n`
        + 'Reply STOP to opt out.';

      const form = new URLSearchParams();
      form.set('To', invite.invited_phone);
      if (messagingService) form.set('MessagingServiceSid', messagingService); else form.set('From', from);
      form.set('Body', text);

      const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        // The URL always carries the ACCOUNT sid; only the credential pair changes.
        headers: { Authorization: 'Basic ' + base64(`${basicUser}:${basicPass}`), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const out = await response.json().catch(() => ({}));
      // Never swallow this. A silent failure looks identical to a delivered text.
      if (!response.ok) return json({ error: 'send_failed', status: response.status, message: out?.message || 'The SMS gateway rejected it.' }, 502);

      await db.from('athlete_invites').update({ sent_via: 'text' }).eq('id', invite.id);
      return json({ ok: true, sid: out?.sid ?? null });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
