-- PRD 5 says "HMAC-signed or JWT". We store an opaque 256-bit random token
-- hashed with a server-side pepper instead. Strictly stronger for this use:
-- instantly revocable by deleting a row, no signing key to rotate or leak, and
-- no signature-stripping / alg-confusion bug class. The token itself never
-- touches the database.
create table public.approval_tokens (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.travel_requests(id) on delete cascade,
  action     public.token_action not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by_ip inet,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_tokens_request on public.approval_tokens (request_id);
create index idx_tokens_live on public.approval_tokens (request_id)
  where used_at is null and revoked_at is null;

-- PRD 7 email_events, widened to cover outbound sends as well as provider
-- delivery callbacks and inbound replies.
create table public.email_events (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid references public.travel_requests(id) on delete cascade,
  type                public.email_event_type not null,
  kind                public.email_kind,
  provider_message_id text,
  -- RFC 5322 Message-ID of what we sent. Matcher strategy 3 resolves an
  -- inbound In-Reply-To/References back to a request through this column.
  message_id_header   text,
  to_email            citext,
  from_email          citext,
  reply_to            citext,
  subject             text,
  payload_json        jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index idx_email_events_request on public.email_events (request_id, created_at desc);
create index idx_email_events_provider on public.email_events (provider_message_id)
  where provider_message_id is not null;
create index idx_email_events_msgid on public.email_events (message_id_header)
  where message_id_header is not null;

-- PRD 4.8 append-only audit trail. No UPDATE/DELETE policy is ever granted.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  request_id    uuid references public.travel_requests(id) on delete cascade,
  event         text not null,
  actor_email   citext,
  actor_id      uuid references public.profiles(id) on delete set null,
  channel       public.decision_channel,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index idx_audit_request on public.audit_log (request_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Inbound staging.
--
-- Resend's `email.received` webhook carries metadata ONLY -- no body, no
-- headers. The body must be fetched in a second API call, which can lag or
-- fail, so an inbound message needs somewhere to live between "webhook
-- acknowledged" and "decision applied". That is this table; it doubles as the
-- retry queue and the replay log.
-- ---------------------------------------------------------------------------
create table public.inbound_emails (
  id                uuid primary key default gen_random_uuid(),
  -- Svix redelivers on any non-2xx. Unique so a redelivery is a no-op insert
  -- rather than a second decision.
  svix_id           text not null unique,
  provider_email_id text,

  received_for      citext,
  from_email        citext,
  to_emails         text[] not null default '{}',
  cc_emails         text[] not null default '{}',
  subject           text,
  message_id_header text,
  in_reply_to       text,
  references_header text,
  webhook_payload   jsonb not null default '{}'::jsonb,

  -- Step 2: fetch the body.
  fetch_status      text not null default 'PENDING',
  fetch_attempts    integer not null default 0,
  last_fetch_error  text,
  next_attempt_at   timestamptz not null default now(),
  raw_text          text,
  raw_html          text,
  headers_json      jsonb,

  -- Step 3: match, verify sender, parse, decide.
  process_status     text not null default 'PENDING',
  matched_request_id uuid references public.travel_requests(id) on delete set null,
  match_strategy     text,
  parse_verdict      text,
  ignored_reason     text,
  processed_at       timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_fetch_status   check (fetch_status   in ('PENDING','FETCHED','FAILED')),
  constraint chk_process_status check (process_status in ('PENDING','PROCESSED','IGNORED','FAILED'))
);

create trigger trg_inbound_emails_updated_at
  before update on public.inbound_emails
  for each row execute function public.set_updated_at();

-- Drives the retry worker.
create index idx_inbound_fetch_due on public.inbound_emails (next_attempt_at)
  where fetch_status = 'PENDING';
create index idx_inbound_process_due on public.inbound_emails (created_at)
  where fetch_status = 'FETCHED' and process_status = 'PENDING';
create index idx_inbound_request on public.inbound_emails (matched_request_id);

-- Local-only mailbox powering /dev/mailbox. Never written when
-- EMAIL_PROVIDER=resend, and dropped from Finance/requester visibility by RLS.
create table public.dev_sent_emails (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references public.travel_requests(id) on delete cascade,
  kind        public.email_kind,
  to_email    citext not null,
  from_email  citext not null,
  reply_to    citext,
  subject     text not null,
  html        text,
  text_body   text,
  message_id_header text,
  headers_json jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index idx_dev_sent_created on public.dev_sent_emails (created_at desc);
