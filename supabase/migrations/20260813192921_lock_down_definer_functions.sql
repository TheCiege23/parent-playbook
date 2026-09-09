-- The security linter flagged every SECURITY DEFINER function as callable by anon.
-- Most are deliberate and must stay that way:
--   invite_preview   a grandmother without an account opens the link
--   team_by_code     a parent applies a coach's code before signing up
--   team_code_used   same flow
-- Two were not deliberate.

-- 1. Never used by anything. The edge functions read notification_log directly with the
--    service role. Left in place it let any caller ask how many messages any guardian
--    had received — a small leak with no upside.
drop function if exists public.notifications_sent_last_week(uuid);

-- 2. accept_invite needs auth.uid(); called as anon it can only fail with a confusing
--    error. Make the requirement explicit rather than implicit.
revoke execute on function public.accept_invite(text) from anon;

-- 3. athlete_owner_first_name returns a household member's first name. It is already
--    gated on the caller having access, but anon can never satisfy that gate, so the
--    grant is pure surface area.
revoke execute on function public.athlete_owner_first_name(uuid) from anon;;
