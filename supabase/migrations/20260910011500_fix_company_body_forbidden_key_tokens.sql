-- The first recursive key filter treated forbidden words as arbitrary substrings.
-- That made the allowed keys surfaceStatus and surfaceProcessing match "face" and
-- rejected every valid SDK record. Normalize camelCase to tokens and reject complete
-- forbidden tokens while keeping the allowed scalar surface provenance.

create or replace function private.company_body_payload_has_forbidden_key(payload jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare item record;
declare normalized_key text;
begin
  if jsonb_typeof(payload) = 'object' then
    for item in select key,value from jsonb_each(payload) loop
      normalized_key=lower(regexp_replace(item.key,'([a-z0-9])([A-Z])','\1_\2','g'));
      if normalized_key ~ '(^|_)(photo|photos|image|images|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces|digest|digests|fingerprint|fingerprints)($|_)' then return true; end if;
      if private.company_body_payload_has_forbidden_key(item.value) then return true; end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for item in select value from jsonb_array_elements(payload) loop
      if private.company_body_payload_has_forbidden_key(item.value) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;
