-- A directory, not a marketplace: no booking, no payment, no per-athlete access
-- control. Every listing points OUT to the organization's own signup. The review gate
-- is the one real safety measure — reuses the same admin-approval shape trainer
-- applications already go through, not a new system.
create table public.camps (
  id uuid primary key default gen_random_uuid(),
  org_name text not null check (char_length(org_name) between 1 and 200),
  contact_name text not null check (char_length(contact_name) between 1 and 120),
  contact_email text not null,
  sport_key text references public.sports(key),
  age_min smallint,
  age_max smallint,
  location_text text not null check (char_length(location_text) between 1 and 200),
  start_date date,
  end_date date,
  description text check (char_length(description) <= 2000),
  external_signup_url text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid not null references public.guardians(id),
  reviewed_by uuid references public.guardians(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index camps_status_idx on public.camps(status, start_date);

alter table public.camps enable row level security;

-- Anyone signed in can browse approved listings — this is a public-within-the-app
-- directory, not scoped to a specific athlete or family.
create policy camps_select_approved on public.camps
  for select using (status = 'approved');

-- A submitter can see their own pending/rejected submissions too, so they know what
-- happened to what they sent in rather than it silently vanishing.
create policy camps_select_own on public.camps
  for select using (created_by = auth.uid());

create policy camps_insert on public.camps
  for insert with check (created_by = auth.uid() and status = 'pending');

-- Only an admin moves a listing out of 'pending' — same private.is_admin() gate the
-- trainer-review queue already uses.
create policy camps_update_admin on public.camps
  for update using (private.is_admin()) with check (private.is_admin());
;
