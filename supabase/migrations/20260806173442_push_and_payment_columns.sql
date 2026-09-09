-- Web-push subscriptions (one row per browser/device a user enables).
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references guardians(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;
create policy ps_select on push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy ps_insert on push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy ps_delete on push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Mark when a booking has been paid (Stripe webhook sets this).
alter table bookings add column if not exists paid_at timestamptz;;
