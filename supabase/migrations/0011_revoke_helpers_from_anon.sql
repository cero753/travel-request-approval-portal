-- ---------------------------------------------------------------------------
-- Close the RLS helper functions to signed-out callers.
--
-- `get_advisors(security)` flagged can_view_request / current_app_role /
-- current_email / is_finance as SECURITY DEFINER functions reachable by `anon`
-- through /rest/v1/rpc/*. They are only ever meant to be evaluated *inside* RLS
-- policies, where the caller is already authenticated.
--
-- `authenticated` keeps EXECUTE — the policies that call these run as the
-- invoking role, so revoking it there would break every policy that uses them.
-- `anon` has no legitimate caller: the only signed-out surfaces in this app are
-- /approve, /reject and the webhooks, and all three use the service role.
--
-- can_view_request in particular answers a yes/no question about a specific
-- request id. As anon the answer is always "no", so this is closing a probe
-- rather than a leak — but an endpoint that exists is an endpoint that can
-- regress, and nothing needs it.
-- ---------------------------------------------------------------------------

revoke execute on function public.can_view_request(uuid) from anon;
revoke execute on function public.current_app_role() from anon;
revoke execute on function public.current_email() from anon;
revoke execute on function public.is_finance() from anon;

-- Note on `citext` living in the public schema: the linter would rather it sat
-- in `extensions`. Moving it means dropping and recreating every citext column
-- in the schema (profiles.email, travel_requests.manager_email, and the rest),
-- which is a materially riskier change than the warning it silences. Left where
-- Supabase's own `create extension` default put it, deliberately.
