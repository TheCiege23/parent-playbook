create or replace function public.create_athlete_onboarding(
  p_new_family boolean,
  p_family_id uuid,
  p_family_name text,
  p_first text,
  p_birthdate date,
  p_hand text,
  p_sport text,
  p_positions text[],
  p_level text,
  p_goals jsonb,
  p_consents jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family uuid;
  v_athlete uuid := gen_random_uuid();
  g jsonb;
  c jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(p_first,'') = '' then raise exception 'first name required'; end if;
  if coalesce(p_sport,'') = '' then raise exception 'sport required'; end if;

  if p_new_family or p_family_id is null then
    v_family := gen_random_uuid();
    insert into families(id, name, created_by)
      values (v_family, coalesce(nullif(p_family_name,''), 'My Family'), v_uid);
    insert into family_members(family_id, guardian_id, role)
      values (v_family, v_uid, 'owner')
      on conflict do nothing;
  else
    v_family := p_family_id;
    if not exists (select 1 from family_members where family_id = v_family and guardian_id = v_uid) then
      raise exception 'not authorized for this family';
    end if;
  end if;

  insert into athletes(id, family_id, first_name, birthdate, dominant_hand, created_by)
    values (v_athlete, v_family, p_first, p_birthdate, nullif(p_hand,''), v_uid);

  insert into athlete_sports(athlete_id, sport_key, positions, level, is_primary)
    values (v_athlete, p_sport, coalesce(p_positions, '{}'::text[]), nullif(p_level,''), true);

  if p_goals is not null then
    for g in select * from jsonb_array_elements(p_goals) loop
      insert into goals(athlete_id, type, sport_key, key, label, created_by)
        values (v_athlete, (g->>'type')::goal_type, p_sport, g->>'key', g->>'label', v_uid);
    end loop;
  end if;

  if p_consents is not null then
    for c in select * from jsonb_array_elements(p_consents) loop
      insert into consent_records(guardian_id, athlete_id, consent_type, granted, method)
        values (v_uid, v_athlete, (c->>'consent_type')::consent_type, true, 'onboarding_checkbox');
    end loop;
  end if;

  return v_athlete;
end;
$$;;
