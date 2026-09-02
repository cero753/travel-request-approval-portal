-- 80 bits of entropy, lowercase hex so it is safe inside a plus-address
-- local part. Deliberately NOT the request id: PRD 4.4 suggests
-- `approvals+<request_id>@`, but that makes every pending request's reply
-- address guessable from any other. This is unguessable and revocable.
create or replace function public.gen_reply_key()
returns text
language sql volatile as $$
  select encode(gen_random_bytes(10), 'hex');
$$;

create table public.travel_requests (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references public.profiles(id) on delete restrict,

  -- Trip. Nullable so a DRAFT can be saved half-finished; completeness is
  -- enforced by chk_complete_when_not_draft once it leaves DRAFT.
  from_city      text,
  to_city        text,
  departure_date date,
  return_date    date,
  mode           public.travel_mode,
  purpose        text,

  -- Bill-to. PRD 4.3 stores "AWIGN" or "PROJECT:<project_id>"; we keep the two
  -- parts separate (queryable, joinable) and expose the PRD's string shape as a
  -- generated column so exports and emails match the spec exactly.
  bill_to        public.bill_to_type,
  project_id     uuid references public.projects(id) on delete restrict,
  project_code   citext,
  bill_to_display text generated always as (
    case
      when bill_to = 'PROJECT' then 'PROJECT:' || coalesce(project_code::text, '')
      when bill_to = 'AWIGN'   then 'AWIGN'
      else null
    end
  ) stored,

  manager_email  citext,

  status         public.request_status not null default 'DRAFT',

  -- One currency per request. PRD 7 puts a currency on every expense row *and*
  -- a single total on the request, which cannot both be right; summing mixed
  -- currencies into one number is silently wrong. Enforced by a trigger in 0004.
  currency       char(3) not null default 'INR',
  total_amount   numeric(14,2) not null default 0,

  -- Inbound reply routing (strategies 1 and 2 of the matcher).
  reply_key      text not null unique default public.gen_reply_key(),

  submitted_at     timestamptz,
  decided_at       timestamptz,
  decided_by_email citext,
  decision_channel public.decision_channel,
  decision_reason  text,

  -- PRD 4.6: expire after N days, remind at N/2.
  expires_at       timestamptz,
  reminder_sent_at timestamptz,

  -- PRD 4.7 "resend approval email (rate-limited)".
  approval_email_count   integer not null default 0,
  last_approval_email_at timestamptz,
  -- PRD 4.5A clarification mail. Capped so an autoresponder cannot loop us.
  clarification_count    integer not null default 0,

  -- Set when a request is cloned via "duplicate to resubmit" after expiry.
  cloned_from_id uuid references public.travel_requests(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_cities_differ check (
    from_city is null or to_city is null or lower(btrim(from_city)) <> lower(btrim(to_city))
  ),
  constraint chk_return_after_departure check (
    return_date is null or departure_date is null or return_date >= departure_date
  ),
  -- Bill-to and project code move together in both directions.
  constraint chk_project_pairing check (
    (bill_to = 'PROJECT' and project_code is not null)
    or (bill_to = 'AWIGN' and project_code is null and project_id is null)
    or (bill_to is null)
  ),
  constraint chk_currency check (currency ~ '^[A-Z]{3}$'),
  constraint chk_total_non_negative check (total_amount >= 0),
  -- Everything PRD 4.1 marks Required must be present the moment the request
  -- stops being a DRAFT. Booking links and >=1 expense row live in child
  -- tables, so those two are enforced in submit_request() instead.
  constraint chk_complete_when_not_draft check (
    status = 'DRAFT' or (
      from_city is not null
      and to_city is not null
      and departure_date is not null
      and mode is not null
      and purpose is not null
      and bill_to is not null
      and manager_email is not null
    )
  ),
  -- A decided request must carry its full decision record, and vice versa.
  constraint chk_decision_complete check (
    (status in ('APPROVED','REJECTED')) = (decided_at is not null and decision_channel is not null)
  )
);

create trigger trg_travel_requests_updated_at
  before update on public.travel_requests
  for each row execute function public.set_updated_at();

create index idx_requests_requester   on public.travel_requests (requester_id, created_at desc);
create index idx_requests_status      on public.travel_requests (status, created_at desc);
create index idx_requests_manager     on public.travel_requests (manager_email, status);
create index idx_requests_project     on public.travel_requests (project_code) where project_code is not null;
create index idx_requests_departure   on public.travel_requests (departure_date);
-- Drives the reminder and expiry cron scans; partial so it stays tiny.
create index idx_requests_pending_due on public.travel_requests (expires_at, reminder_sent_at)
  where status = 'PENDING_APPROVAL';
