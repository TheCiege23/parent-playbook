-- Separate from coach_update_reports.status: a message can be auto_flagged with no
-- parent report at all, and still needs somewhere for an admin to mark "looked at
-- this, it's fine" without needing a report row to exist first.
alter table public.coach_updates add column if not exists admin_reviewed boolean not null default false;

create policy cu_update_admin on public.coach_updates
  for update using (private.is_admin()) with check (private.is_admin());
;
