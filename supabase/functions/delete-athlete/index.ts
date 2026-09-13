// delete-athlete: the Deno entry point. The logic, and why its order is safe, is in handler.mjs.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createDeleteAthleteHandler } from "./handler.mjs";

const URL = Deno.env.get("SUPABASE_URL")!;
// The PUBLISHABLE key, not the legacy anon JWT that SUPABASE_ANON_KEY holds. This function used the
// legacy key after delete-account moved off it, which kept that key alive. Both only create a client
// that carries the CALLER's Authorization header, so row-level security evaluates as that user; neither
// grants anything on its own. The publishable key is public by design and already ships in js/core.js;
// the environment lookup comes first so a rotation needs a secret change, not a redeploy.
const PUBLISHABLE = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const service = createClient(URL, SERVICE);

Deno.serve(createDeleteAthleteHandler({
  callerClient: (auth: string) => createClient(URL, PUBLISHABLE, { global: { headers: { Authorization: auth } } }),
  serviceClient: service,
}));
