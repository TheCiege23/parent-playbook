// send-invite — the only growth mechanism the product has.
//
// Sharing was removed (CHANGES-2026-08-13), so an invite IS the distribution. Until this function a parent
// generated a link and copied it into a text message by hand; anyone who wanted to invite a grandparent had to
// be the kind of person who does that.
//
// The logic lives here, apart from the Deno entry point, so it runs under Node's test runner
// (tests/send-invite-function.test.cjs). What makes it safe to expose:
//
//   - it verifies the CALLER can edit the athlete (owner or co-parent), not merely that they are signed in,
//     using the caller's own client so row-level security applies;
//   - it never takes an address from the request body: the recipient is whatever is stored on the invite row,
//     which only an editor could have set;
//   - a failed send is reported, never swallowed, because a silent failure looks exactly like a delivered email;
//   - database and runtime error text is not echoed to the caller.

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

export const ROLE_LABEL = Object.freeze({
  family_view: 'family view — they can see games, photos and the week, but cannot change anything',
  co_parent: 'co-parent access — they can log games and mark sessions done, but not change your account',
  coach: 'Team Connect access — athlete stats and training updates only',
});

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

import { callerCanEditAthlete } from '../_shared/invite-access.mjs';

export function createSendInviteHandler({ callerClient, db, fetch: fetchImpl = globalThis.fetch, env = {}, now = () => new Date() } = {}) {
  if (typeof callerClient !== 'function' || !db || typeof fetchImpl !== 'function') throw new TypeError('createSendInviteHandler needs callerClient, db and fetch');
  const siteUrl = env.SITE_URL || 'https://playbookbp.com';

  // The template is fetched from the site rather than bundled: it is HTML whose whole purpose is to be mailed,
  // so there is nothing to protect, and the email is edited by redeploying the site, not this function.
  const templateUrl = siteUrl + '/emails/invite.html';
  let templateCache = null;
  async function loadTemplate() {
    if (templateCache) return templateCache;
    const response = await fetchImpl(templateUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error('template fetch failed: ' + response.status);
    const text = await response.text();
    if (!/{{invite_url}}/.test(text)) throw new Error('template has no {{invite_url}}');
    templateCache = text;
    return text;
  }

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

      const { data: invite, error: inviteError } = await db.from('athlete_invites')
        .select('id, athlete_id, role, scope, token, invited_email, created_by, expires_at, accepted_at, revoked_at')
        .eq('id', inviteId).maybeSingle();
      if (inviteError) return json({ error: 'internal_error' }, 500);
      if (!invite) return json({ error: 'not_found' }, 404);
      if (invite.revoked_at || invite.accepted_at) return json({ error: 'invite is no longer active' }, 409);
      if (!invite.invited_email) return json({ error: 'no_email', message: 'This invite has no email address on it.' }, 400);

      // The read above used the service role and bypassed row-level security. Without this gate any signed-in
      // user could mail any invite to its recipient.
      if (!(await callerCanEditAthlete(caller, invite.athlete_id, user.id))) return json({ error: 'forbidden' }, 403);

      const key = env.RESEND_API_KEY;
      if (!key) {
        return json({ error: 'email_not_configured',
          message: 'RESEND_API_KEY is not set on this project, so the invite email cannot be sent. The link itself still works — copy it instead.' }, 503);
      }

      const [{ data: athlete }, { data: guardian }] = await Promise.all([
        db.from('athletes').select('first_name, birthdate, family_id').eq('id', invite.athlete_id).maybeSingle(),
        db.from('guardians').select('display_name').eq('id', invite.created_by).maybeSingle(),
      ]);
      const { data: primarySport } = await db.from('athlete_sports')
        .select('sport_key').eq('athlete_id', invite.athlete_id).eq('is_primary', true).maybeSingle();
      const sport = primarySport ? (await db.from('sports').select('name').eq('key', primarySport.sport_key).maybeSingle()).data : null;

      const age = athlete?.birthdate ? Math.floor((now().getTime() - new Date(athlete.birthdate).getTime()) / 31557600000) : null;
      const inviterFull = (guardian?.display_name || '').trim() || 'A parent';
      const inviterFirst = inviterFull.split(/\s+/)[0];
      const inviteUrl = siteUrl + '/?invite=' + encodeURIComponent(invite.token);
      const expires = new Date(invite.expires_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const familyWide = invite.scope === 'family' && invite.role !== 'coach';
      let childCount = 1;
      if (familyWide && athlete?.family_id) {
        const { count } = await db.from('athletes').select('id', { count: 'exact', head: true }).eq('family_id', athlete.family_id);
        childCount = Math.max(1, count || 1);
      }
      const athleteFirst = athlete?.first_name || 'their athlete';
      const athleteDetails = [age != null ? `${age} years old` : '', sport?.name ? `plays ${sport.name}` : ''].filter(Boolean).join(' and ');
      const inviteHeadline = familyWide
        ? `${inviterFirst} wants you to follow the family's sports journey.`
        : `${inviterFirst} wants you to follow ${athleteFirst}'s season.`;
      const inviteIntro = familyWide
        ? `This one invite includes ${childCount === 1 ? 'the child' : `all ${childCount} children`} in the household — their games, milestones, photos and weekly plans. Nothing here is public.`
        : `Parent Playbook is where the family keeps ${athleteFirst}'s games, milestones, photos and weekly plan.${athleteDetails ? ` ${athleteFirst} is ${athleteDetails}.` : ''} Nothing here is public.`;

      const vars = {
        athlete_first: escapeHtml(athleteFirst),
        athlete_age: age != null ? String(age) : '',
        sport: escapeHtml(sport?.name || ''),
        inviter_first: escapeHtml(inviterFirst),
        inviter_full: escapeHtml(inviterFull),
        role_label: escapeHtml(ROLE_LABEL[invite.role] || ROLE_LABEL.family_view),
        invite_headline: escapeHtml(inviteHeadline),
        invite_intro: escapeHtml(inviteIntro),
        access_first: escapeHtml(familyWide ? 'Games, photos and milestones for every child'
          : (invite.role === 'coach' ? 'Age, sport, position and current stats' : 'Games, photos and milestones')),
        access_second: escapeHtml(familyWide ? 'Each child\'s weekly plan and progress'
          : (invite.role === 'coach' ? 'Growth, scan measurements and training updates' : `${athleteFirst}'s weekly plan and progress`)),
        access_limit: escapeHtml(invite.role === 'coach' ? 'No games, journey, photos or weekly plan'
          : (invite.role === 'co_parent' ? 'No billing or account changes' : 'No editing or account changes')),
        invite_url: inviteUrl, // built here from the stored token; escaping would break the href
        expires_human: escapeHtml(expires),
      };
      const template = await loadTemplate();
      const html = template.replace(/\{\{(\w+)\}\}/g, (_match, name) => vars[name] ?? '');
      // Subjects are plain text, not HTML, and carry the same names.
      const subject = familyWide
        ? `${inviterFirst} invited you to Parent Playbook for the whole family`
        : `${inviterFirst} wants you to follow ${athleteFirst}'s season`;
      const from = env.INVITE_FROM || 'Parent Playbook <hello@send.playbookbp.com>';

      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [invite.invited_email], subject, html, reply_to: 'support@playbookbp.com' }),
      });
      const out = await response.json().catch(() => ({}));
      // Never swallow this. A silent failure looks identical to a delivered email, and the parent sits waiting
      // for a grandparent who never got anything.
      if (!response.ok) return json({ error: 'send_failed', status: response.status }, 502);
      return json({ ok: true, id: out?.id ?? null, to: invite.invited_email });
    } catch {
      return json({ error: 'internal_error' }, 500);
    }
  };
}
