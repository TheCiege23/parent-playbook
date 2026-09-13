// notify-trainer-review: the Deno entry point. Who may announce a review decision is in handler.mjs.
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createNotifyTrainerReviewHandler } from './handler.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
// The PUBLISHABLE key, not the legacy anon JWT. It only creates a client that carries the CALLER's Authorization
// header so row-level security evaluates as that user; it grants nothing on its own. It is public by design and
// already ships in js/core.js.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';

Deno.serve(createNotifyTrainerReviewHandler({
  callerClient: (auth: string) => createClient(URL, PUBLISHABLE, { global: { headers: { Authorization: auth } } }),
  db: createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
  push: webpush,
  env: {
    VAPID_PUBLIC_KEY: Deno.env.get('VAPID_PUBLIC_KEY'),
    VAPID_PRIVATE_KEY: Deno.env.get('VAPID_PRIVATE_KEY'),
    VAPID_SUBJECT: Deno.env.get('VAPID_SUBJECT'),
  },
}));
