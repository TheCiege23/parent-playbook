-- The B1 guard triggers were left with a role-mutable search_path while the helpers they
-- call were pinned. A trigger that resolves unqualified names through a caller-controlled
-- search_path is the classic way a security check gets bypassed, and these two are the
-- checks standing between an unscreened adult and a listed trainer profile.
-- Names inside are already schema-qualified, so pinning is safe.
alter function private.tv_guard() set search_path = '';
alter function private.tp_guard() set search_path = '';;
