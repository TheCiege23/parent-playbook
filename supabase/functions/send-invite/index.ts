// send-invite: the Deno entry point. Who may send, and to whom, is in handler.mjs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createSendInviteHandler } from './handler.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
// The PUBLISHABLE key, not the legacy anon JWT. It only creates a client that carries the CALLER's Authorization
// header so row-level security evaluates as that user; it grants nothing on its own. It is public by design and
// already ships in js/core.js. The environment lookup comes first so a rotation needs a secret change, not a redeploy.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';

Deno.serve(createSendInviteHandler({
  callerClient: (auth: string) => createClient(URL, PUBLISHABLE, { global: { headers: { Authorization: auth } } }),
  db: createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
  env: { SITE_URL: Deno.env.get('SITE_URL'), RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'), INVITE_FROM: Deno.env.get('INVITE_FROM') },
}));
