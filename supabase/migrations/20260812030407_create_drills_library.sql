-- Training content moves out of js/program.js and into the database, so drills can be
-- added, corrected, and CITED without a code deploy.
--
-- Provenance is the point of this table. `source_name`/`source_url` are nullable and
-- must stay NULL for anything whose origin we can't actually vouch for — the UI shows a
-- citation only when one exists, so an empty source reads as "uncited", never as
-- implied authority.
create table if not exists public.drills (
  id             uuid primary key default gen_random_uuid(),
  sport_key      text references public.sports(key) on delete cascade,   -- NULL = generic fallback
  band           text not null check (band in ('young','mid','old')),
  position_codes text[] not null default '{}',                           -- empty = sport-general
  title          text not null,
  duration       text,
  why            text not null,
  how            text[] not null default '{}',
  say            text,
  mistake        text,
  stop           text,
  -- provenance (all nullable on purpose — see note above)
  source_name    text,
  source_url     text,
  source_note    text,
  reviewed_by    text,
  reviewed_on    date,
  status         text not null default 'published' check (status in ('draft','published','archived')),
  sort           int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists drills_lookup_idx on public.drills (sport_key, band, status);
create index if not exists drills_positions_idx on public.drills using gin (position_codes);

alter table public.drills enable row level security;

-- everyone signed in reads published drills; only admins see drafts or write anything
drop policy if exists drills_read on public.drills;
create policy drills_read on public.drills for select to authenticated
  using (status = 'published' or private.is_admin());

drop policy if exists drills_write on public.drills;
create policy drills_write on public.drills for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

comment on table public.drills is
  'Age-banded training content. Mirrors skillsFor() in js/program.js: position_codes=[] means a sport-general drill, sport_key=NULL means the generic fallback.';
comment on column public.drills.source_name is
  'Human-readable source (e.g. "USA Football — Football Development Model"). NULL means UNCITED — the app must not imply expert authority for these.';;
