-- ---------------------------------------------------------------------------
-- Fix for 0011, which was applied and did nothing.
--
-- 0011 ran `revoke execute ... from anon`. That succeeded and changed nothing,
-- because `anon` never held a *direct* grant. Postgres grants EXECUTE on every
-- new function to `PUBLIC` by default, and `anon` is a member of PUBLIC like
-- every other role. Revoking a privilege a role does not directly hold is a
-- silent no-op — `has_function_privilege('anon', ...)` still returned true
-- afterwards, which is how this was caught.
--
-- The correct move is to revoke from PUBLIC and then grant back explicitly to
-- the two roles that need it. Verified safe first: every policy in `public` is
-- declared `TO authenticated` (checked against pg_policies), so no policy is
-- ever evaluated as `anon`. Revoking here cannot turn a signed-out read into a
-- "permission denied for function" error, because there are no signed-out
-- reads — /approve, /reject and the webhooks all use the service role.
--
-- The state-machine functions (decide_request, submit_request,
-- consume_approval_token, cancel_request, claim_due_reminders,
-- expire_due_requests) were confirmed to already be service-role only: both
-- anon and authenticated report false. Those are the ones that move money, and
-- they were never exposed. This migration closes four read-only predicates.
-- ---------------------------------------------------------------------------

revoke execute on function public.can_view_request(uuid) from public;
revoke execute on function public.current_app_role() from public;
revoke execute on function public.current_email() from public;
revoke execute on function public.is_finance() from public;

-- `authenticated` needs these because the RLS policies that call them run as
-- the invoking role. `service_role` bypasses RLS but calls them directly in a
-- few places, so it keeps EXECUTE too.
grant execute on function public.can_view_request(uuid) to authenticated, service_role;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.current_email() to authenticated, service_role;
grant execute on function public.is_finance() to authenticated, service_role;
