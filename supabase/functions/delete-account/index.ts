// delete-account: the Deno entry point. What it does, and why in that order, is in handler.mjs.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createDeleteAccountHandler } from "./handler.mjs";

const URL = Deno.env.get("SUPABASE_URL")!;
// The PUBLISHABLE key, not the legacy anon JWT.
//
// SUPABASE_ANON_KEY is auto-injected and holds the legacy anon JWT, the same key the browser app
// stopped using. Reading it here is what kept that key alive and blocked disabling it. Both keys do the
// identical job in this file: they create a client that carries the CALLER's Authorization header so
// RLS evaluates as that user. Neither grants anything on its own.
//
// Hardcoding is safe and deliberate: the publishable key is public by design and already ships in
// js/core.js to every browser. The env lookup comes first so a future rotation needs a secret change,
// not a redeploy.
const PUBLISHABLE = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createDeleteAccountHandler({
  callerClient: (auth: string) => createClient(URL, PUBLISHABLE, { global: { headers: { Authorization: auth } } }),
  serviceClient: createClient(URL, SERVICE),
}));
