// notify-gameday: the Deno entry point. Who gets the game-day reminder is in handler.mjs; send policy is in ../_shared/push-policy.mjs.
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createNotifyGamedayHandler } from './handler.mjs';

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(createNotifyGamedayHandler({
  db: createClient(Deno.env.get('SUPABASE_URL')!, SERVICE),
  push: webpush,
  env: {
    SERVICE_KEY: SERVICE,
    VAPID_PUBLIC_KEY: Deno.env.get('VAPID_PUBLIC_KEY'),
    VAPID_PRIVATE_KEY: Deno.env.get('VAPID_PRIVATE_KEY'),
    VAPID_SUBJECT: Deno.env.get('VAPID_SUBJECT'),
  },
}));
