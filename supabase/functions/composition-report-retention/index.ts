// composition-report-retention: the Deno entry point. What it removes, and why SQL cannot, is in handler.mjs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCompositionReportRetentionHandler } from './handler.mjs';

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(createCompositionReportRetentionHandler({
  db: createClient(Deno.env.get('SUPABASE_URL')!, SERVICE),
  env: { SERVICE_KEY: SERVICE },
}));
