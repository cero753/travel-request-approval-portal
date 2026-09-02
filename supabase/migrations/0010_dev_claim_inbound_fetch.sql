-- Atomic claim for a simulated step-two fetch: bumps the attempt counter and
-- reports whether this particular attempt was told to fail.
--
-- The old value of fail_fetches_remaining is captured in a CTE rather than read
-- from RETURNING. RETURNING exposes only the post-update value, where "1
-- remaining" and "0 remaining" both read as 0 -- which made the first forced
-- failure silently succeed. Doing it in one statement also keeps the
-- "fail twice then succeed" test deterministic under concurrent retries.

create or replace function public.dev_claim_inbound_fetch(p_provider_email_id text)
returns table (should_fail boolean, attempt int)
language sql
security definer
set search_path = public, pg_temp
as $$
  with before as (
    select provider_email_id, fail_fetches_remaining as old_remaining
      from public.dev_inbound_bodies
     where provider_email_id = p_provider_email_id
     for update
  ),
  bumped as (
    update public.dev_inbound_bodies d
       set fetch_count = d.fetch_count + 1,
           fail_fetches_remaining = greatest(d.fail_fetches_remaining - 1, 0)
      from before b
     where d.provider_email_id = b.provider_email_id
    returning d.fetch_count, b.old_remaining
  )
  select old_remaining > 0, fetch_count from bumped;
$$;

revoke all on function public.dev_claim_inbound_fetch(text) from public, anon, authenticated;
grant execute on function public.dev_claim_inbound_fetch(text) to service_role;
