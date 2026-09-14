-- Adult Training, milestone 2: a parent's own eating plan.
--
-- Food preferences and the allergens a parent chooses to avoid, recipes they add themselves, meals they plan for the
-- week, and two eating habits they log. Same rules as the milestone 1 record (20260914120000):
--
--   - every table is keyed by guardian_id and readable only by that guardian. No co-parent, family viewer, coach or
--     organization policy exists, and nothing joins it to a child's athlete profile or plan;
--   - writes also need the adult_training_access allowlist; reading and deleting do not;
--   - nothing here is estimated or prescribed. A recipe's allergen tags and cost are what the parent entered, and the
--     habit targets (meals with a protein food, meals following the plate guide) are numbers the parent chose. No
--     nutrient value, portion prescription or body target is stored;
--   - every row goes with the account: guardian_id cascades from auth.users, and supabase/functions/delete-account
--     deletes these tables explicitly before it deletes the login.

-- The nine major food allergens named in U.S. labeling law, and the plate groups of the USDA MyPlate guide.
create or replace function private.adult_allergens_ok(list text[])
returns boolean language sql immutable set search_path = '' as $$
  select list is not null
     and cardinality(list) <= 9
     and list <@ array['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soy', 'sesame']::text[];
$$;

create or replace function private.adult_plate_groups_ok(list text[])
returns boolean language sql immutable set search_path = '' as $$
  select list is not null
     and cardinality(list) <= 5
     and list <@ array['vegetables', 'fruits', 'grains', 'protein', 'dairy']::text[];
$$;

-- Ingredient lines: at most 40, each 1 to 120 characters.
create or replace function private.adult_ingredients_ok(list text[])
returns boolean language sql immutable set search_path = '' as $$
  select list is not null
     and cardinality(list) between 1 and 40
     and not exists (select 1 from unnest(list) i where i is null or length(i) not between 1 and 120);
$$;
-- These three stay executable by the caller: a CHECK constraint runs them as whoever is writing the row. They read
-- nothing but their argument.

-- ---------------------------------------------------------------------------------------------
-- The record.
create table if not exists public.adult_nutrition_preferences (
  guardian_id uuid primary key references auth.users(id) on delete cascade,
  eating_pattern text,
  avoid_allergens text[] not null default '{}',
  avoid_other text,
  weekly_budget text,
  cooking_minutes smallint,
  -- The parent's own habit targets, in meals a day. Never filled in for them.
  protein_meals_target smallint,
  plate_meals_target smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adult_nutrition_preferences_pattern_check
    check (eating_pattern is null or eating_pattern in ('no_preference', 'vegetarian', 'vegan', 'pescatarian', 'other')),
  constraint adult_nutrition_preferences_allergens_check check (private.adult_allergens_ok(avoid_allergens)),
  constraint adult_nutrition_preferences_other_check check (avoid_other is null or length(avoid_other) between 1 and 200),
  constraint adult_nutrition_preferences_budget_check check (weekly_budget is null or weekly_budget in ('tight', 'moderate', 'flexible')),
  constraint adult_nutrition_preferences_cooking_check check (cooking_minutes is null or cooking_minutes in (15, 30, 45, 60, 90)),
  constraint adult_nutrition_preferences_targets_check
    check ((protein_meals_target is null or protein_meals_target between 0 and 6)
       and (plate_meals_target is null or plate_meals_target between 0 and 6))
);

create table if not exists public.adult_recipes (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  minutes smallint,
  servings smallint,
  ingredients text[] not null,
  steps text,
  allergens text[] not null default '{}',
  plate_groups text[] not null default '{}',
  -- The parent's own estimate of what the recipe costs to make, in their currency.
  cost_estimate numeric(7, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adult_recipes_id_guardian_key unique (id, guardian_id),
  constraint adult_recipes_title_check check (length(title) between 1 and 80),
  constraint adult_recipes_minutes_check check (minutes is null or minutes between 1 and 600),
  constraint adult_recipes_servings_check check (servings is null or servings between 1 and 24),
  constraint adult_recipes_ingredients_check check (private.adult_ingredients_ok(ingredients)),
  constraint adult_recipes_steps_check check (steps is null or length(steps) between 1 and 4000),
  constraint adult_recipes_allergens_check check (private.adult_allergens_ok(allergens)),
  constraint adult_recipes_plate_groups_check check (private.adult_plate_groups_ok(plate_groups)),
  constraint adult_recipes_cost_check check (cost_estimate is null or (cost_estimate >= 0 and cost_estimate < 10000))
);
create index if not exists adult_recipes_guardian_idx on public.adult_recipes (guardian_id, title);

create table if not exists public.adult_meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  planned_on date not null,
  slot text not null,
  recipe_id uuid,
  -- The recipe's title when it was planned, or a meal typed in without a recipe.
  title text not null,
  created_at timestamptz not null default now(),
  constraint adult_meal_plan_items_slot_check check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  constraint adult_meal_plan_items_title_check check (length(title) between 1 and 80),
  -- A planned meal can only use a recipe of the same guardian. Deleting the recipe keeps the planned meal, unlinked.
  constraint adult_meal_plan_items_recipe_fkey foreign key (recipe_id, guardian_id)
    references public.adult_recipes (id, guardian_id) on delete set null (recipe_id)
);
create index if not exists adult_meal_plan_items_guardian_idx on public.adult_meal_plan_items (guardian_id, planned_on);
create index if not exists adult_meal_plan_items_recipe_idx on public.adult_meal_plan_items (recipe_id, guardian_id);

create table if not exists public.adult_nutrition_days (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  logged_on date not null,
  protein_meals smallint,
  plate_meals smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adult_nutrition_days_counts_check
    check ((protein_meals is not null or plate_meals is not null)
       and (protein_meals is null or protein_meals between 0 and 6)
       and (plate_meals is null or plate_meals between 0 and 6)),
  constraint adult_nutrition_days_once_a_day_key unique (guardian_id, logged_on)
);

-- ---------------------------------------------------------------------------------------------
-- Access: the guardian, and only the guardian. Creating and changing also need the allowlist. A habit day more than a
-- day ahead is refused (a day, because the family's date and the server's can differ), and so is a meal planned more
-- than 60 days ahead.
alter table public.adult_nutrition_preferences enable row level security;
alter table public.adult_recipes enable row level security;
alter table public.adult_meal_plan_items enable row level security;
alter table public.adult_nutrition_days enable row level security;

create policy adult_nutrition_preferences_select on public.adult_nutrition_preferences for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_nutrition_preferences_delete on public.adult_nutrition_preferences for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_nutrition_preferences_insert on public.adult_nutrition_preferences for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_nutrition_preferences_update on public.adult_nutrition_preferences for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_recipes_select on public.adult_recipes for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_recipes_delete on public.adult_recipes for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_recipes_insert on public.adult_recipes for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_recipes_update on public.adult_recipes for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_meal_plan_items_select on public.adult_meal_plan_items for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_meal_plan_items_delete on public.adult_meal_plan_items for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_meal_plan_items_insert on public.adult_meal_plan_items for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and planned_on <= current_date + 60);
create policy adult_meal_plan_items_update on public.adult_meal_plan_items for update to authenticated
  using (guardian_id = (select auth.uid()))
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and planned_on <= current_date + 60);

create policy adult_nutrition_days_select on public.adult_nutrition_days for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_nutrition_days_delete on public.adult_nutrition_days for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_nutrition_days_insert on public.adult_nutrition_days for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and logged_on <= current_date + 1);
create policy adult_nutrition_days_update on public.adult_nutrition_days for update to authenticated
  using (guardian_id = (select auth.uid()))
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and logged_on <= current_date + 1);

revoke all on public.adult_nutrition_preferences, public.adult_recipes, public.adult_meal_plan_items,
  public.adult_nutrition_days from anon, authenticated;
grant select, insert, update, delete on public.adult_nutrition_preferences, public.adult_recipes,
  public.adult_meal_plan_items, public.adult_nutrition_days to authenticated;
