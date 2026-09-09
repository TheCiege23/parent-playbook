const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "backgrounds";
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3HCocWDpBHp3ijsVaZySmTBOEHR/";
const IMAGES: Record<string, string> = {
  "field.png": CDN + "hf_20260731_195427_dfb4b9f4-c53a-46bc-8d13-d8454c3b7e2b.png",
  "court.png": CDN + "hf_20260731_201110_65461f3c-0ed4-4a45-8ea9-5415bd86ad44.png",
  "track.png": CDN + "hf_20260731_201501_927bd6fe-8e09-4c44-9b2c-3bd6c5c6cc8e.png",
  "night.png": CDN + "hf_20260731_201505_c794e9de-117e-4672-8f8c-db787d9bb977.png",
};
const AUTH = { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY };

Deno.serve(async () => {
  const out: Record<string, string> = {};
  const cb = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  out["_bucket"] = `${cb.status} ${(await cb.text()).slice(0, 120)}`;
  for (const [name, url] of Object.entries(IMAGES)) {
    try {
      const r = await fetch(url);
      if (!r.ok) { out[name] = `fetch ${r.status}`; continue; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "image/png", "x-upsert": "true" },
        body: bytes,
      });
      out[name] = up.ok ? `ok ${bytes.length}b` : `upload ${up.status}: ${(await up.text()).slice(0,160)}`;
    } catch (e) {
      out[name] = "err: " + ((e as Error)?.message ?? String(e));
    }
  }
  const base = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  return new Response(JSON.stringify({ out, base }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
