// The send policy the four scheduled notification functions share (notify-daily, notify-weekly, notify-gameday
// and notify-measure), and the web-push delivery loop they all ran. Each used to carry its own copy. The rules
// come from the design handoff, platform §6, and are enforced here rather than trusted to the cron schedule,
// because a schedule change is one click and a parent pushed at 11pm never turns notifications back on:
//
//   - four messages a week at most, per guardian;
//   - nothing between 9pm and 7am, in America/New_York (the household timezone is not stored, and every current
//     user is in Bergenfield, NJ; revisit before anyone outside US Eastern signs up);
//   - a failed cap check fails OPEN, so bookkeeping trouble never silently mutes a family;
//   - a 404 or 410 from the push service means the browser threw the subscription away, so it is deleted;
//     anything else is reported, because a total delivery failure must not look like "nobody subscribed".

export const WEEKLY_CAP = 4;
export const QUIET_FROM = 21;
export const QUIET_TO = 7;
export const APP_TZ = 'America/New_York';
const WEEK_MS = 7 * 86400000;

// Is this the scheduler rather than a signed-in person? Two accepted proofs, because a project can hold both a
// legacy JWT service_role key and a new sb_secret_* key, and the one injected here need not match the one stored
// in Vault byte for byte: the bearer equals the injected service key, or it is a JWT whose role claim is
// service_role. The second is safe only because verify_jwt is on for these functions: the gateway has already
// verified the signature, so the claim is an authenticated value, not an assertion.
export function isScheduler(bearer, serviceKey) {
  if (!bearer) return false;
  if (serviceKey && bearer === serviceKey) return true;
  const parts = bearer.split('.');
  if (parts.length !== 3) return false;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json)?.role === 'service_role';
  } catch {
    return false;
  }
}

export function localHour(now) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour: 'numeric', hour12: false }).format(now), 10) % 24;
}

export function inQuietHours(now) {
  const hour = localHour(now);
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

export function bearerOf(req) {
  return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

/** Messages each guardian has received in the seven days before `now`. Null when the log could not be read. */
export async function weeklyCounts(db, guardianIds, now) {
  const counts = {};
  if (!guardianIds.length) return counts;
  const since = new Date(now.getTime() - WEEK_MS).toISOString();
  const { data, error } = await db.from('notification_log').select('guardian_id').in('guardian_id', guardianIds).gte('sent_at', since);
  if (error) return null;
  for (const row of data || []) counts[row.guardian_id] = (counts[row.guardian_id] || 0) + 1;
  return counts;
}

/** Guardians at or over `limit` messages this week. Fails open: an unreadable log caps nobody. */
export async function overCap(db, guardianIds, now, limit = WEEKLY_CAP) {
  const counts = await weeklyCounts(db, guardianIds, now);
  const capped = new Set();
  if (!counts) return capped;
  for (const id of guardianIds) if ((counts[id] || 0) >= limit) capped.add(id);
  return capped;
}

/** Children's first names per guardian, through family membership, without duplicates. */
export function namesByGuardian(memberships, children) {
  const namesByFamily = new Map();
  for (const child of children || []) {
    const list = namesByFamily.get(child.family_id) || [];
    if (child.first_name) list.push(child.first_name);
    namesByFamily.set(child.family_id, list);
  }
  const byGuardian = new Map();
  for (const member of memberships || []) {
    const list = byGuardian.get(member.guardian_id) || [];
    for (const name of namesByFamily.get(member.family_id) || []) if (!list.includes(name)) list.push(name);
    byGuardian.set(member.guardian_id, list);
  }
  return byGuardian;
}

/** "Sam", "Sam and Ava", "Sam, Ava and Leo". */
export function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return names[0] + ' and ' + names[1];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/** Opted-out guardians for one preference column. A missing preferences row means opted in. */
export async function optedOut(db, guardianIds, column) {
  if (!guardianIds.length) return new Set();
  const { data } = await db.from('notification_prefs').select('guardian_id, ' + column).in('guardian_id', guardianIds);
  return new Set((data || []).filter(row => row[column] === false).map(row => row.guardian_id));
}

/**
 * Deliver one message per subscription.
 *   message(userId) -> [title, body] | null   null skips that subscription
 *   skip(userId)    -> 'capped' | 'opted_out' | 'yielded' | null
 * Sends are logged to notification_log after they succeed; a failed log write never blocks a send.
 */
export async function deliver({ db, push, subscriptions, message, skip = () => null, dry, url, kind, vapid }) {
  const tally = { sent: 0, skipped: 0, reaped: 0, cappedOut: 0, yielded: 0, failures: [], preview: [] };
  if (!dry) push.setVapidDetails(vapid.subject || 'mailto:support@playbookbp.com', vapid.publicKey, vapid.privateKey);
  for (const subscription of subscriptions) {
    const reason = skip(subscription.user_id);
    if (reason === 'capped') { tally.cappedOut++; continue; }
    if (reason === 'yielded') { tally.yielded++; continue; }
    if (reason === 'opted_out') { tally.skipped++; continue; }
    const msg = message(subscription.user_id);
    if (!msg) { tally.skipped++; continue; }
    const [title, body] = msg;
    if (dry) { tally.preview.push({ title, body }); tally.sent++; continue; }
    try {
      await push.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title, body, url }));
      tally.sent++;
      await db.from('notification_log').insert({ guardian_id: subscription.user_id, kind });
    } catch (error) {
      const code = error?.statusCode;
      if (code === 404 || code === 410) {
        await db.from('push_subscriptions').delete().eq('id', subscription.id);
        tally.reaped++;
      } else {
        tally.failures.push({ code: code ?? null, message: String(error?.body || error?.message || error).slice(0, 200) });
      }
    }
  }
  return tally;
}

export function vapidMissing(vapid) {
  return !vapid?.publicKey || !vapid?.privateKey;
}
