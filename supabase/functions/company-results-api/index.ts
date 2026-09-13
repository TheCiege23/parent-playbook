// company-results-api — server-to-server access to an organization's stored results, by API key.
//
// Callers present an organization API key, not a Supabase user session, so this function must be
// deployed with JWT verification off:
//
//   supabase functions deploy company-results-api --no-verify-jwt
//
// That is safe only because nothing here decides access. The service-role client below can call
// exactly four database functions, and each of them authenticates the key itself: hash lookup,
// expiry, revocation, scope, rate limit, tenant, roster and live consent. See handler.mjs and
// supabase/migrations/20260913120000_company_results_api.sql.
//
// No CORS headers are sent, on purpose. An organization API key belongs on a server; a browser that
// could call this directly would have to hold the key where any page script can read it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createResultsApiHandler } from "./handler.mjs";

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createResultsApiHandler({ rpc: (name: string, args: Record<string, unknown>) => service.rpc(name, args) }));
