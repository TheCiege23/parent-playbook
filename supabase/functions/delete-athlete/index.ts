import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "missing auth" }, 401);
    const body = await req.json().catch(() => ({}));
    const athleteId = body?.athlete_id;
    if (!athleteId) return json({ error: "athlete_id required" }, 400);

    const caller = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const service = createClient(URL, SERVICE);

    // 1) collect every file under the athlete's folder (service sees all)
    const paths: string[] = [];
    let offset = 0;
    while (true) {
      const { data: files, error } = await service.storage.from("athlete-media").list(athleteId, { limit: 100, offset });
      if (error || !files || files.length === 0) break;
      for (const f of files) paths.push(`${athleteId}/${f.name}`);
      if (files.length < 100) break;
      offset += 100;
    }

    // 2) delete the athlete as the CALLER — RLS enforces that they own it
    const { error: delErr, count } = await caller.from("athletes").delete({ count: "exact" }).eq("id", athleteId);
    if (delErr) return json({ error: delErr.message }, 403);
    if (!count) return json({ error: "not found or not permitted" }, 403);

    // 3) ownership confirmed + rows gone -> purge the actual files (service)
    let filesRemoved = 0;
    if (paths.length) {
      const { error: rmErr } = await service.storage.from("athlete-media").remove(paths);
      if (!rmErr) filesRemoved = paths.length;
    }
    return json({ ok: true, files_removed: filesRemoved });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
