// Whether a six-digit invite code is the one issued for this invite. Shared by send-invite and send-invite-sms.
// issue_invite_code() (20260905145010) stores only sha256(code || ':' || token) as hex, and accept_invite() checks
// the recipient's entry the same way, so a message must never carry a code that fails this: the recipient would be
// asked for six digits that cannot open the invite.
export async function inviteCodeMatches(code, token, codeHash) {
  if (!/^\d{6}$/.test(String(code ?? '')) || !token || !codeHash) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code + ':' + token));
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return hex === String(codeHash).toLowerCase();
}
