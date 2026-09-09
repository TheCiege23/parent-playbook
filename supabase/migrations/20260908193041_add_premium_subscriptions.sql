
-- Item 8: premium subscription infra. One guardian, one subscription row — a household's
-- premium status follows whoever paid, not per-athlete. All writes come from the Stripe
-- webhook (service role); a guardian can only ever read their own row.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null unique references auth.users(id) on delete cascade,
  price_bucket text,                      -- which price point they were shown, for the A/B read
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'inactive', -- inactive | active | past_due | canceled
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy sub_select on public.subscriptions for select using (guardian_id = auth.uid());
-- No insert/update/delete policy at all — every write is service-role, from the webhook.

create or replace function private.is_premium()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions
    where guardian_id = auth.uid() and status = 'active'
      and (current_period_end is null or current_period_end > now())
  );
$$;
;
