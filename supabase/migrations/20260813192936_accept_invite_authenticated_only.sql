-- Revoking from `anon` does nothing when the grant is on PUBLIC — anon inherits it.
-- Revoke the PUBLIC grant, then hand it back to authenticated only.
revoke execute on function public.accept_invite(text) from public;
revoke execute on function public.accept_invite(text) from anon;
grant  execute on function public.accept_invite(text) to authenticated;;
