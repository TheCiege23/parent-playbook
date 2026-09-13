// send-invite-sms: the Deno entry point. Why the number comes only from the invite row, and why a code is
// required, is in handler.mjs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createSendInviteSmsHandler } from './handler.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
// The publishable key, not the legacy anon JWT — same reasoning as send-invite.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';
const env = (name: string) => Deno.env.get(name);

Deno.serve(createSendInviteSmsHandler({
  callerClient: (auth: string) => createClient(URL, PUBLISHABLE, { global: { headers: { Authorization: auth } } }),
  db: createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
  env: {
    SITE_URL: env('SITE_URL'),
    TWILIO_ACCOUNT_SID: env('TWILIO_ACCOUNT_SID'), TWILIO_AUTH_TOKEN: env('TWILIO_AUTH_TOKEN'),
    TWILIO_API_KEY: env('TWILIO_API_KEY'), TWILIO_API_SECRET: env('TWILIO_API_SECRET'),
    TWILIO_MESSAGING_SERVICE_SID: env('TWILIO_MESSAGING_SERVICE_SID'),
    TWILIO_FROM: env('TWILIO_FROM'), TWILIO_PHONE_NUMBER: env('TWILIO_PHONE_NUMBER'),
  },
}));
