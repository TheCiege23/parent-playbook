-- ===== ENUMS (guarded so re-runs don't error) =====
do $$ begin create type trainer_status     as enum ('draft','submitted','in_review','needs_info','approved','suspended','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type verification_kind   as enum ('identity','background_check','safesport','credential','reference'); exception when duplicate_object then null; end $$;
do $$ begin create type verification_status as enum ('not_started','pending','submitted','passed','failed','expired'); exception when duplicate_object then null; end $$;
do $$ begin create type service_format      as enum ('in_person','virtual','hybrid'); exception when duplicate_object then null; end $$;
do $$ begin create type booking_status      as enum ('requested','confirmed','declined','cancelled','completed','no_show'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_status      as enum ('pending','authorized','captured','refunded','failed'); exception when duplicate_object then null; end $$;
do $$ begin create type report_status       as enum ('open','reviewing','actioned','dismissed'); exception when duplicate_object then null; end $$;

-- ===== TABLES =====
create table if not exists trainer_profiles (
  id uuid primary key references guardians(id) on delete cascade,
  status trainer_status not null default 'draft',
  legal_name text, display_name text, slug text unique,
  headline text, bio text, years_experience int,
  city text, region text, postal_code text,
  service_radius_km int, offers_virtual boolean default false,
  base_rate_cents int, currency text default 'usd',
  avatar_url text, intro_video_url text, stripe_account_id text,
  submitted_at timestamptz, approved_at timestamptz,
  approved_by uuid references guardians(id),
  suspended_reason text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists trainer_sports (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  sport_key text not null references sports(key),
  specialty text, years int,
  unique (trainer_id, sport_key)
);

create table if not exists trainer_credentials (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  name text not null, issuer text, credential_number text,
  issued_on date, expires_on date, doc_path text,
  status verification_status not null default 'submitted',
  reviewed_by uuid references guardians(id), reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists trainer_verifications (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  kind verification_kind not null,
  status verification_status not null default 'not_started',
  provider text, external_ref text, result_summary text, doc_path text,
  submitted_at timestamptz, completed_at timestamptz, expires_at timestamptz,
  reviewed_by uuid references guardians(id),
  created_at timestamptz default now(),
  unique (trainer_id, kind)
);

create table if not exists trainer_references (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  name text not null, relationship text, email text, phone text,
  status verification_status not null default 'submitted',
  notes text, reviewed_by uuid references guardians(id), reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  sport_key text references sports(key),
  title text not null, description text,
  format service_format not null default 'in_person',
  duration_min int not null default 60,
  price_cents int not null, currency text default 'usd',
  max_group_size int default 1, location_text text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references services(id) on delete set null,
  trainer_id uuid not null references trainer_profiles(id),
  parent_id uuid not null references guardians(id),
  athlete_id uuid references athletes(id) on delete set null,
  status booking_status not null default 'requested',
  scheduled_at timestamptz, duration_min int,
  price_cents int, currency text default 'usd',
  location_text text, parent_note text, trainer_note text,
  cancelled_by uuid references guardians(id), cancel_reason text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists trainer_athlete_grants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  scope jsonb not null default '{"first_name":true,"sport":true,"age_band":true,"shared_goals":false,"notes":true}',
  granted_by uuid not null references guardians(id),
  granted_at timestamptz default now(), expires_at timestamptz, revoked_at timestamptz
);

create table if not exists booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  sender_id uuid not null references guardians(id),
  body text not null, created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete set null,
  parent_id uuid references guardians(id),
  trainer_id uuid references trainer_profiles(id),
  amount_cents int not null, platform_fee_cents int not null default 0,
  currency text default 'usd', stripe_payment_intent text,
  status payment_status not null default 'pending',
  created_at timestamptz default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references bookings(id) on delete set null,
  trainer_id uuid not null references trainer_profiles(id) on delete cascade,
  parent_id uuid not null references guardians(id),
  rating int not null check (rating between 1 and 5),
  body text, is_published boolean default true,
  created_at timestamptz default now()
);

create table if not exists trainer_reports (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references trainer_profiles(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  reporter_id uuid references guardians(id),
  reason text not null, detail text,
  status report_status not null default 'open',
  reviewed_by uuid references guardians(id), reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists trainer_review_actions (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references trainer_profiles(id) on delete cascade,
  admin_id uuid references guardians(id),
  action text not null, note text,
  created_at timestamptz default now()
);

-- ===== INDEXES on foreign keys =====
create index if not exists trainer_sports_trainer_idx      on trainer_sports(trainer_id);
create index if not exists trainer_sports_sport_idx        on trainer_sports(sport_key);
create index if not exists trainer_credentials_trainer_idx on trainer_credentials(trainer_id);
create index if not exists trainer_verifications_trainer_idx on trainer_verifications(trainer_id);
create index if not exists trainer_references_trainer_idx  on trainer_references(trainer_id);
create index if not exists services_trainer_idx            on services(trainer_id);
create index if not exists services_sport_idx              on services(sport_key);
create index if not exists bookings_trainer_idx            on bookings(trainer_id);
create index if not exists bookings_parent_idx             on bookings(parent_id);
create index if not exists bookings_athlete_idx            on bookings(athlete_id);
create index if not exists bookings_service_idx            on bookings(service_id);
create index if not exists grants_trainer_idx              on trainer_athlete_grants(trainer_id);
create index if not exists grants_athlete_idx              on trainer_athlete_grants(athlete_id);
create index if not exists grants_booking_idx              on trainer_athlete_grants(booking_id);
create index if not exists grants_granted_by_idx           on trainer_athlete_grants(granted_by);
create index if not exists booking_messages_booking_idx    on booking_messages(booking_id);
create index if not exists booking_messages_sender_idx     on booking_messages(sender_id);
create index if not exists payments_booking_idx            on payments(booking_id);
create index if not exists payments_parent_idx             on payments(parent_id);
create index if not exists payments_trainer_idx            on payments(trainer_id);
create index if not exists reviews_trainer_idx             on reviews(trainer_id);
create index if not exists reviews_parent_idx              on reviews(parent_id);
create index if not exists trainer_reports_trainer_idx     on trainer_reports(trainer_id);
create index if not exists trainer_reports_reporter_idx    on trainer_reports(reporter_id);
create index if not exists trainer_review_actions_trainer_idx on trainer_review_actions(trainer_id);

-- ===== ENABLE RLS (deny-all until policies added in a later migration) =====
alter table trainer_profiles       enable row level security;
alter table trainer_sports         enable row level security;
alter table trainer_credentials    enable row level security;
alter table trainer_verifications  enable row level security;
alter table trainer_references     enable row level security;
alter table services               enable row level security;
alter table bookings               enable row level security;
alter table trainer_athlete_grants enable row level security;
alter table booking_messages       enable row level security;
alter table payments               enable row level security;
alter table reviews                enable row level security;
alter table trainer_reports        enable row level security;
alter table trainer_review_actions enable row level security;

-- ===== Seed the first admin (your account) =====
insert into app_admins(guardian_id) values ('74ea7be3-beb7-4c95-9594-ca8047a11f54')
  on conflict (guardian_id) do nothing;;
