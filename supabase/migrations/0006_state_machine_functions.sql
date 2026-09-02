-- ===========================================================================
-- State machine.
--
-- Every status transition lives here rather than in application code. A
-- manager can reply to the approval email and click the fallback link seconds
-- apart; Svix redelivers webhooks; a reply can land while the expiry cron is
-- mid-scan. Each of those is a lost-update race if the check and the write are
-- two separate round trips. Doing it as one conditional UPDATE ... RETURNING
-- makes Postgres the arbiter: exactly one caller can observe `applied = true`.
--
-- These are SECURITY DEFINER and are NOT granted to anon/authenticated. They
-- are invoked only from server-side code holding the service-role key, which
-- has already authorised the caller. RLS still guards every direct table read.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- DRAFT -> PENDING_APPROVAL
--
-- The >=1 booking link and >=1 expense row rules from PRD 4.1/4.2 live in child
-- tables, so they cannot be CHECK constraints; this is the only place they can
-- be enforced atomically with the transition.
-- ---------------------------------------------------------------------------
create or replace function public.submit_request(
  p_request_id  uuid,
  p_actor_email citext,
  p_expiry_days integer default 7
)
returns table (ok boolean, error_code text, new_expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row     public.travel_requests;
  v_expires timestamptz;
begin
  select * into v_row from public.travel_requests r where r.id = p_request_id for update;

  if not found then
    return query select false, 'not_found'::text, null::timestamptz; return;
  end if;
  if v_row.status <> 'DRAFT' then
    return query select false, 'not_draft'::text, null::timestamptz; return;
  end if;
  if not exists (select 1 from public.expense_items e where e.request_id = p_request_id) then
    return query select false, 'no_expense_items'::text, null::timestamptz; return;
  end if;
  if not exists (select 1 from public.booking_links b where b.request_id = p_request_id) then
    return query select false, 'no_booking_links'::text, null::timestamptz; return;
  end if;

  v_expires := now() + make_interval(days => p_expiry_days);

  -- The chk_complete_when_not_draft constraint fires here and rejects the
  -- transition if any PRD-required scalar field is still null.
  update public.travel_requests r
     set status       = 'PENDING_APPROVAL',
         submitted_at = now(),
         expires_at   = v_expires
   where r.id = p_request_id
     and r.status = 'DRAFT';

  insert into public.audit_log (request_id, event, actor_email, channel, metadata_json)
  values (p_request_id, 'request.submitted', p_actor_email, 'PORTAL',
          jsonb_build_object('expires_at', v_expires, 'expiry_days', p_expiry_days));

  return query select true, null::text, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- PENDING_APPROVAL -> APPROVED | REJECTED
--
-- The single most important function in the system. Returns applied=false
-- rather than raising when it loses a race, so the caller can send an
-- "already decided" courtesy reply instead of a 500.
-- ---------------------------------------------------------------------------
create or replace function public.decide_request(
  p_request_id  uuid,
  p_decision    public.request_status,
  p_channel     public.decision_channel,
  p_actor_email citext,
  p_reason      text default null
)
returns table (applied boolean, final_status public.request_status, error_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.travel_requests;
begin
  if p_decision not in ('APPROVED','REJECTED') then
    raise exception 'decide_request: decision must be APPROVED or REJECTED, got %', p_decision
      using errcode = 'invalid_parameter_value';
  end if;

  update public.travel_requests r
     set status           = p_decision,
         decided_at       = now(),
         decided_by_email = p_actor_email,
         decision_channel = p_channel,
         decision_reason  = p_reason
   where r.id = p_request_id
     and r.status = 'PENDING_APPROVAL'
  returning r.* into v_row;

  if found then
    -- PRD 4.5: "invalidate any outstanding tokens".
    update public.approval_tokens t
       set revoked_at = now()
     where t.request_id = p_request_id
       and t.used_at is null
       and t.revoked_at is null;

    insert into public.audit_log (request_id, event, actor_email, channel, metadata_json)
    values (p_request_id,
            case when p_decision = 'APPROVED' then 'request.approved' else 'request.rejected' end,
            p_actor_email, p_channel,
            jsonb_build_object('reason', p_reason));

    return query select true, v_row.status, null::text;
    return;
  end if;

  -- Lost the race, or was never pending. Record the attempt and report why.
  select * into v_row from public.travel_requests r where r.id = p_request_id;
  if not found then
    return query select false, null::public.request_status, 'not_found'::text;
    return;
  end if;

  insert into public.audit_log (request_id, event, actor_email, channel, metadata_json)
  values (p_request_id, 'decision.ignored_not_pending', p_actor_email, p_channel,
          jsonb_build_object('attempted', p_decision, 'current_status', v_row.status));

  return query select false, v_row.status, 'not_pending'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Single-use token redemption.
--
-- Single-use is enforced by `WHERE used_at IS NULL ... RETURNING`, not by a
-- read-then-write, so two simultaneous clicks cannot both succeed.
-- ---------------------------------------------------------------------------
create or replace function public.consume_approval_token(
  p_token_hash text,
  p_ip         inet default null
)
returns table (ok boolean, error_code text, request_id uuid, action public.token_action)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tok public.approval_tokens;
begin
  update public.approval_tokens t
     set used_at    = now(),
         used_by_ip = p_ip
   where t.token_hash = p_token_hash
     and t.used_at    is null
     and t.revoked_at is null
     and t.expires_at > now()
  returning t.* into v_tok;

  if found then
    return query select true, null::text, v_tok.request_id, v_tok.action;
    return;
  end if;

  select * into v_tok from public.approval_tokens t where t.token_hash = p_token_hash;
  if not found then
    return query select false, 'invalid'::text, null::uuid, null::public.token_action;
  elsif v_tok.used_at is not null then
    return query select false, 'already_used'::text, v_tok.request_id, v_tok.action;
  elsif v_tok.revoked_at is not null then
    return query select false, 'revoked'::text, v_tok.request_id, v_tok.action;
  else
    return query select false, 'expired'::text, v_tok.request_id, v_tok.action;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- DRAFT | PENDING_APPROVAL -> CANCELLED  (PRD 4.6, requester-initiated)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_request(
  p_request_id  uuid,
  p_actor_email citext
)
returns table (applied boolean, final_status public.request_status, error_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.travel_requests;
begin
  update public.travel_requests r
     set status = 'CANCELLED'
   where r.id = p_request_id
     and r.status in ('DRAFT','PENDING_APPROVAL')
  returning r.* into v_row;

  if found then
    update public.approval_tokens t
       set revoked_at = now()
     where t.request_id = p_request_id and t.used_at is null and t.revoked_at is null;

    insert into public.audit_log (request_id, event, actor_email, channel, metadata_json)
    values (p_request_id, 'request.cancelled', p_actor_email, 'PORTAL', '{}'::jsonb);

    return query select true, v_row.status, null::text;
    return;
  end if;

  select * into v_row from public.travel_requests r where r.id = p_request_id;
  if not found then
    return query select false, null::public.request_status, 'not_found'::text;
  else
    return query select false, v_row.status, 'not_cancellable'::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron claims.
--
-- FOR UPDATE SKIP LOCKED plus the same-statement flag write means a second
-- overlapping cron run claims a disjoint set: no request is ever reminded or
-- expired twice, even if the scheduler double-fires.
-- ---------------------------------------------------------------------------

-- PRD 4.6: one reminder at N/2 days. Derived from the request's own window
-- rather than a hardcoded day count, so changing EXPIRY_DAYS needs no new SQL.
create or replace function public.claim_due_reminders(p_limit integer default 50)
returns setof uuid
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select r.id
      from public.travel_requests r
     where r.status = 'PENDING_APPROVAL'
       and r.reminder_sent_at is null
       and r.expires_at is not null
       and r.submitted_at is not null
       and now() >= r.submitted_at + (r.expires_at - r.submitted_at) / 2
     order by r.expires_at
     limit p_limit
     for update skip locked
  ), upd as (
    update public.travel_requests r
       set reminder_sent_at = now()
      from due
     where r.id = due.id
    returning r.id
  ), aud as (
    insert into public.audit_log (request_id, event, channel, metadata_json)
    select upd.id, 'reminder.due', 'SYSTEM', '{}'::jsonb from upd
    returning audit_log.id
  )
  select upd.id from upd;
$$;

create or replace function public.expire_due_requests(p_limit integer default 100)
returns setof uuid
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select r.id
      from public.travel_requests r
     where r.status = 'PENDING_APPROVAL'
       and r.expires_at is not null
       and r.expires_at <= now()
     order by r.expires_at
     limit p_limit
     for update skip locked
  ), upd as (
    update public.travel_requests r
       set status = 'EXPIRED'
      from due
     where r.id = due.id
    returning r.id
  ), tok as (
    update public.approval_tokens t
       set revoked_at = now()
     where t.request_id in (select upd.id from upd)
       and t.used_at is null
       and t.revoked_at is null
    returning t.id
  ), aud as (
    insert into public.audit_log (request_id, event, channel, metadata_json)
    select upd.id, 'request.expired', 'SYSTEM', '{}'::jsonb from upd
    returning audit_log.id
  )
  select upd.id from upd;
$$;

-- ---------------------------------------------------------------------------
-- Lock these down. The service-role key is the only caller.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.submit_request(uuid, citext, integer)',
    'public.decide_request(uuid, public.request_status, public.decision_channel, citext, text)',
    'public.consume_approval_token(text, inet)',
    'public.cancel_request(uuid, citext)',
    'public.claim_due_reminders(integer)',
    'public.expire_due_requests(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
