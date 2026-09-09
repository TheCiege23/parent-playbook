// delete-account — a parent erases their account and everything under it, themselves.
//
// The privacy policy promises this, and until now it meant emailing support and waiting
// for a human to do it by hand in the dashboard. COPPA gives a parent the right to delete
// their child's data; a right you have to ask permission to exercise is a weak one.
//
// The hard part is not the athlete rows — those cascade. It is:
//   1. STORAGE. Deleting a database row does not delete the photo. Files must be listed
//      and removed explicitly, and that is the thing the user most wants gone.
//   2. NOT NULL back-references. consent_records.guardian_id, families.created_by and
//      athlete_invites.created_by all point at auth.users with NO ACTION and cannot be
//      nulled, so deleting the user fails outright while any of them survive.
//   3. Co-parents. If a grandparent or second parent shares the household, deleting one
//      adult must NOT delete the other adult's children. Ownership transfers instead.
//
// Order is deliberate: gather file paths -> delete rows -> purge files -> delete the user
// LAST, so a failure part-way leaves the account intact and retryable rather than
// half-erased and unreachable.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
// The PUBLISHABLE key, not the legacy anon JWT.
//
// SUPABASE_ANON_KEY is auto-injected and holds the legacy anon JWT — the same key
// the browser app stopped using. Reading it here is what kept that key alive and
// blocked disabling it. Both keys do the identical job in this file: they create a
// client that carries the CALLER's Authorization header so RLS evaluates as that
// user. Neither grants anything on its own.
//
// Hardcoding is safe and deliberate: the publishable key is public by design and
// already ships in js/core.js to every browser. The env lookup comes first so a
// future rotation needs a secret change, not a redeploy.
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  ?? 'sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';
const ANON = PUBLISHABLE;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Every file under a bucket folder, paged.
async function listFolder(svc: any, bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await svc.storage.from(bucket).list(folder, { limit: 100, offset });
    if (error || !data || data.length === 0) break;
    for (const f of data) out.push(`${folder}/${f.name}`);
    if (data.length < 100) break;
    offset += 100;
  }
  return out;
}

Deno.serve(async (req) => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "missing auth" }, 401);

    // Typed confirmation, so a stray POST cannot erase a family.
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") return json({ error: "confirmation required" }, 400);

    const caller = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const uid = user.id;

    const svc = createClient(URL, SERVICE);

    // ---- 1. which households does this person belong to, and are they alone in them? ----
    const { data: myFams } = await svc.from("family_members").select("family_id").eq("guardian_id", uid);
    const familyIds = [...new Set((myFams || []).map((r: any) => r.family_id))];

    const athleteIdsToPurge: string[] = [];
    let familiesDeleted = 0, familiesLeft = 0;

    for (const fid of familyIds) {
      const { data: members } = await svc.from("family_members")
        .select("guardian_id, created_at").eq("family_id", fid).order("created_at");
      const others = (members || []).filter((m: any) => m.guardian_id !== uid);

      const { data: kids } = await svc.from("athletes").select("id").eq("family_id", fid);
      const kidIds = (kids || []).map((k: any) => k.id);

      if (others.length === 0) {
        // Sole guardian: the household goes with them. Collect photo paths BEFORE the
        // rows disappear — afterwards there is nothing left to tell us what to delete.
        for (const kid of kidIds) athleteIdsToPurge.push(kid);
        const { error } = await svc.from("families").delete().eq("id", fid);
        if (error) return json({ error: `could not delete household: ${error.message}` }, 500);
        familiesDeleted++;
      } else {
        // Someone else still parents these children. Hand over the records that cannot
        // be orphaned, then remove only this person's membership.
        const heir = others[0].guardian_id;
        await svc.from("families").update({ created_by: heir }).eq("id", fid).eq("created_by", uid);
        if (kidIds.length) {
          await svc.from("athlete_invites").update({ created_by: heir })
            .eq("created_by", uid).in("athlete_id", kidIds);
          // The consent record is the legal basis for holding a child's data and cannot be
          // deleted while the child remains. It passes to the guardian who is staying.
          await svc.from("consent_records").update({ guardian_id: heir })
            .eq("guardian_id", uid).in("athlete_id", kidIds);
        }
        await svc.from("family_members").delete().eq("family_id", fid).eq("guardian_id", uid);
        familiesLeft++;
      }
    }

    // ---- 2. release the nullable back-references, or the user delete is refused ----
    const nullable: Array<[string, string]> = [
      ["athletes", "created_by"], ["goals", "created_by"], ["measurements", "created_by"],
      ["sessions", "created_by"], ["schedule_events", "created_by"],
      ["schedule_exceptions", "created_by"], ["teams", "created_by"],
      ["access_log", "actor_id"], ["athlete_access", "granted_by"],
      ["athlete_invites", "accepted_by"],
    ];
    for (const [table, col] of nullable) {
      await svc.from(table).update({ [col]: null }).eq(col, uid);
    }

    // ---- 3. purge the actual files. This is the part a parent actually means. ----
    let filesRemoved = 0;
    for (const aid of athleteIdsToPurge) {
      const paths = await listFolder(svc, "athlete-media", aid);
      if (paths.length) {
        const { error } = await svc.storage.from("athlete-media").remove(paths);
        if (!error) filesRemoved += paths.length;
      }
    }
    // Anything they uploaded as a trainer applicant (ID, background report, certificate).
    const trainerDocs = await listFolder(svc, "trainer-verification-docs", uid);
    if (trainerDocs.length) {
      const { error } = await svc.storage.from("trainer-verification-docs").remove(trainerDocs);
      if (!error) filesRemoved += trainerDocs.length;
    }

    // ---- 4. the account itself, last ----
    // guardians, app_admins, push_subscriptions and trainer_profiles all cascade from here.
    const { error: delErr } = await svc.auth.admin.deleteUser(uid);
    if (delErr) {
      // Most likely a NO ACTION reference we do not clear on purpose — a booking, payment
      // or review, which are financial records. Say so plainly instead of failing silently.
      return json({
        error: "Your data was removed, but the login could not be deleted automatically: " +
               delErr.message + " Please contact support@playbookbp.com to finish.",
        partial: true, families_deleted: familiesDeleted, files_removed: filesRemoved,
      }, 500);
    }

    return json({
      ok: true,
      families_deleted: familiesDeleted,
      families_left: familiesLeft,
      files_removed: filesRemoved,
    });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500);
  }
});
