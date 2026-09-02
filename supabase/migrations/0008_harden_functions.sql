-- ===========================================================================
-- Advisor remediation.
--
-- Closes two real findings from the Supabase database linter:
--   0011 function_search_path_mutable
--   0028/0029 SECURITY DEFINER functions reachable over /rest/v1/rpc
-- ===========================================================================

-- A SECURITY DEFINER function with a caller-controlled search_path can be
-- hijacked by shadowing a referenced object in a schema the caller creates.
-- Pinning search_path removes that class of attack. These two were missed in
-- 0001/0003 because they look "too simple to matter" -- they still run as the
-- definer.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOTE the `extensions` schema in the search_path: on Supabase, pgcrypto is
-- pre-installed there rather than in `public`, so `gen_random_bytes` is not
-- resolvable from `public` alone. Pinning the path is what exposed this --
-- previously it only worked by accident, via the role's default search_path.
create or replace function public.gen_reply_key()
returns text
language sql volatile
set search_path = public, extensions, pg_temp as $$
  select encode(gen_random_bytes(10), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Everything in `public` is published by PostgREST at /rest/v1/rpc/<name>, so
-- a SECURITY DEFINER helper is callable by an unauthenticated visitor unless
-- EXECUTE is revoked. None of these should be reachable that way.
--
-- The four RLS helpers keep EXECUTE for `authenticated`: policy expressions
-- are evaluated as the invoking role, so revoking it there would make every
-- policy that calls them fail closed and lock legitimate users out of their
-- own requests.
-- ---------------------------------------------------------------------------
revoke all on function public.current_app_role()          from anon;
revoke all on function public.current_email()             from anon;
revoke all on function public.is_finance()                from anon;
revoke all on function public.can_view_request(uuid)      from anon;

grant execute on function public.current_app_role()       to authenticated;
grant execute on function public.current_email()          to authenticated;
grant execute on function public.is_finance()             to authenticated;
grant execute on function public.can_view_request(uuid)   to authenticated;

-- Trigger functions. Postgres invokes these itself and does not check the
-- calling user's EXECUTE privilege, so nothing needs them exposed.
revoke all on function public.handle_new_user()       from public, anon, authenticated;
revoke all on function public.recalc_request_total()  from public, anon, authenticated;
revoke all on function public.set_updated_at()        from public, anon, authenticated;
revoke all on function public.gen_reply_key()         from public, anon, authenticated;
