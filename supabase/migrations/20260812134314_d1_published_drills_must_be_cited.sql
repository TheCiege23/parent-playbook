-- D1. The whole reason `drills` exists is to hold content whose provenance can be
-- shown to a parent. A published row with no source is the original problem wearing
-- a new hat, so make it unrepresentable rather than relying on the editor UI.
-- Drafts are exempt: that is where an in-progress drill lives while it is sourced.
--
-- To relax: alter table public.drills drop constraint drills_published_needs_source;
alter table public.drills
  add constraint drills_published_needs_source
  check (status <> 'published' or (source_name is not null and length(btrim(source_name)) > 0));;
