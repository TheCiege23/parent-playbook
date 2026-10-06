// Native push for the App Store and Play Store builds: APNs for iOS, FCM HTTP v1 for Android.
//
// The apps keep their device token in the same push_subscriptions table as browsers, with no schema
// change: the endpoint is the token with its service as a scheme, `apns:<token>` or `fcm:<token>`,
// beside the https:// endpoints browsers have, and p256dh/auth hold the fixed value 'native' because
// there is nothing to encrypt to. js/native.js registers it through the same claim_push_subscription
// a browser uses. Displacing another parent's row on a shared phone then takes the full endpoint,
// which means the token itself: Apple or Google issue it to this app install, the app sends it here
// and nowhere else, and holding it conveys nothing without our APNs key or Firebase service account.
//
// sendPush() routes each row by its endpoint, so every notify-* function keeps one loop.
//
// No SDKs: both services take a signed JWT, and WebCrypto in the Edge runtime signs ES256 (APNs) and
// RS256 (Google OAuth) natively. Tokens are cached in memory for well under their lifetime.
//
// Secrets (Supabase → Edge Functions → Secrets). A platform whose secrets are missing is reported as
// a send failure rather than silently skipped, so a half-configured launch shows up in the tally.
//   APNS_KEY_ID        the 10-character Key ID of the .p8 key (Apple Developer → Keys)
//   APNS_TEAM_ID       the 10-character Team ID
//   APNS_PRIVATE_KEY   the .p8 file's contents, PEM, newlines intact or as \n
//   APNS_BUNDLE_ID     com.playbookbp.app
//   APNS_ENV           'production' (TestFlight and the App Store) or 'sandbox' (Xcode debug builds)
//   FCM_SERVICE_ACCOUNT the Firebase service-account JSON (Project settings → Service accounts)

const APNS_HOST = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
// Apple rejects a provider token older than an hour and throttles one refreshed more than every 20 minutes.
const APNS_TOKEN_TTL_MS = 45 * 60 * 1000;

const PREFIX = Object.freeze({ ios: 'apns:', android: 'fcm:' });
export const NATIVE_KEY = 'native';

// 'ios' | 'android' | null (a browser's https:// endpoint, or anything else).
export function nativePlatformOf(endpoint) {
  if (typeof endpoint !== 'string') return null;
  if (endpoint.startsWith(PREFIX.ios)) return 'ios';
  if (endpoint.startsWith(PREFIX.android)) return 'android';
  return null;
}

// An error the senders throw for a token Apple or Google says is gone. statusCode 410 is what the
// existing reaping logic already treats as "delete this row".
function goneError(message) {
  const error = new Error(message);
  error.statusCode = 410;
  return error;
}
function sendError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  error.body = message;
  return error;
}

const b64url = bytes => {
  let s = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = value => b64url(new TextEncoder().encode(JSON.stringify(value)));

export function pemToDer(pem) {
  const body = String(pem || '').replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('empty key');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function signJwt(subtle, key, algorithm, header, claims) {
  const input = b64urlJson(header) + '.' + b64urlJson(claims);
  const signature = await subtle.sign(algorithm, key, new TextEncoder().encode(input));
  return input + '.' + b64url(signature);
}

export function readNativeEnv(get) {
  let fcm = null;
  const raw = get('FCM_SERVICE_ACCOUNT');
  if (raw) {
    try { fcm = JSON.parse(raw); } catch { fcm = null; }
  }
  return {
    apns: {
      keyId: get('APNS_KEY_ID') || '',
      teamId: get('APNS_TEAM_ID') || '',
      privateKey: get('APNS_PRIVATE_KEY') || '',
      bundleId: get('APNS_BUNDLE_ID') || '',
      environment: get('APNS_ENV') === 'sandbox' ? 'sandbox' : 'production',
    },
    fcm,
  };
}

/**
 * createNativePush({ config, fetch, now, subtle }) -> { configured, send(subscription, payload) }
 *   config   readNativeEnv(Deno.env.get)
 *   payload  { title, body, url }
 */
export function createNativePush({ config = {}, fetch = globalThis.fetch, now = () => Date.now(), subtle = globalThis.crypto?.subtle } = {}) {
  const apns = config.apns || {};
  const fcm = config.fcm || null;
  const configured = {
    ios: !!(apns.keyId && apns.teamId && apns.privateKey && apns.bundleId),
    android: !!(fcm && fcm.client_email && fcm.private_key && fcm.project_id),
  };

  let apnsKey = null;
  let apnsToken = null;
  let googleKey = null;
  let googleToken = null;

  async function apnsBearer() {
    const at = now();
    if (apnsToken && at - apnsToken.at < APNS_TOKEN_TTL_MS) return apnsToken.value;
    if (!apnsKey) {
      apnsKey = await subtle.importKey('pkcs8', pemToDer(apns.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    }
    const value = await signJwt(subtle, apnsKey, { name: 'ECDSA', hash: 'SHA-256' },
      { alg: 'ES256', kid: apns.keyId }, { iss: apns.teamId, iat: Math.floor(at / 1000) });
    apnsToken = { value, at };
    return value;
  }

  async function googleBearer() {
    const at = now();
    if (googleToken && at < googleToken.expiresAt - 60_000) return googleToken.value;
    if (!googleKey) {
      googleKey = await subtle.importKey('pkcs8', pemToDer(fcm.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    }
    const iat = Math.floor(at / 1000);
    const assertion = await signJwt(subtle, googleKey, { name: 'RSASSA-PKCS1-v1_5' },
      { alg: 'RS256', typ: 'JWT' },
      { iss: fcm.client_email, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(assertion),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw sendError(res.status, 'google oauth: ' + (data.error || res.status));
    googleToken = { value: data.access_token, expiresAt: at + (Number(data.expires_in) || 3600) * 1000 };
    return googleToken.value;
  }

  async function sendIos(token, { title, body, url }) {
    const res = await fetch(APNS_HOST[apns.environment] + '/3/device/' + encodeURIComponent(token), {
      method: 'POST',
      headers: {
        authorization: 'bearer ' + await apnsBearer(),
        'apns-topic': apns.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, url: url || '/' }),
    });
    if (res.ok) return;
    const data = await res.json().catch(() => ({}));
    const reason = data.reason || String(res.status);
    // 410: the app was removed or notifications were turned off for good. BadDeviceToken /
    // DeviceTokenNotForTopic: the token is not one this key and bundle can ever reach.
    if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered') {
      throw goneError('apns: ' + reason);
    }
    if (res.status === 403) apnsToken = null;
    throw sendError(res.status, 'apns: ' + reason);
  }

  async function sendAndroid(token, { title, body, url }) {
    const res = await fetch('https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(fcm.project_id) + '/messages:send', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + await googleBearer(), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: { url: url || '/' },
          android: { priority: 'high', notification: { sound: 'default' } },
        },
      }),
    });
    if (res.ok) return;
    const data = await res.json().catch(() => ({}));
    const details = (data.error && data.error.details) || [];
    const code = details.map(d => d && d.errorCode).find(Boolean) || (data.error && data.error.status) || String(res.status);
    if (res.status === 404 || code === 'UNREGISTERED') throw goneError('fcm: ' + code);
    if (res.status === 401) googleToken = null;
    throw sendError(res.status, 'fcm: ' + code);
  }

  async function send(subscription, payload) {
    const endpoint = subscription && subscription.endpoint;
    const platform = nativePlatformOf(endpoint);
    if (platform === 'ios') {
      if (!configured.ios) throw sendError(null, 'apns: not configured');
      return sendIos(endpoint.slice(PREFIX.ios.length), payload);
    }
    if (platform === 'android') {
      if (!configured.android) throw sendError(null, 'fcm: not configured');
      return sendAndroid(endpoint.slice(PREFIX.android.length), payload);
    }
    throw sendError(null, 'not a native endpoint');
  }

  return { configured, send };
}

/**
 * One send to one push_subscriptions row, whatever it is.
 *   push    the web-push module, VAPID details already set
 *   native  createNativePush(...) result, or null when the function was built without it
 */
export async function sendPush({ push, native }, subscription, payload) {
  if (nativePlatformOf(subscription && subscription.endpoint)) {
    if (!native) throw sendError(null, 'native push not configured');
    return native.send(subscription, payload);
  }
  return push.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
  );
}
