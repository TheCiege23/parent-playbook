-- Move SECURITY DEFINER helper functions out of the API-exposed `public` schema.
-- PostgREST only exposes `public`, so relocating to `private` removes the
-- /rest/v1/rpc/* attack surface while RLS policies (which bind by function OID)
-- keep working. authenticated needs USAGE on the schema to evaluate the policies.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

alter function public.is_family_member(uuid)  set schema private;
alter function public.is_family_editor(uuid)  set schema private;
alter function public.can_view_athlete(uuid)  set schema private;
alter function public.can_edit_athlete(uuid)  set schema private;
alter function public.handle_new_family()      set schema private;;
