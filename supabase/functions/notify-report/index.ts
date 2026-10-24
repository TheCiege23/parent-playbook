// notify-report: the Deno entry point. Which reports get emailed, and what the email says, is in handler.mjs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createNotifyReportHandler } from './handler.mjs';

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(createNotifyReportHandler({
  db: createClient(Deno.env.get('SUPABASE_URL')!, SERVICE),
  env: {
    SERVICE_KEY: SERVICE,
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
    SUPPORT_EMAIL: Deno.env.get('SUPPORT_EMAIL'),
    ALERT_FROM: Deno.env.get('ALERT_FROM'),
  },
}));
