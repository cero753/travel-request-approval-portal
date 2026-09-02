-- Local stand-in for the mailbox Resend keeps on its side.
--
-- The whole point of the two-step inbound design is that the webhook carries
-- metadata only and the body must be fetched separately. To exercise that
-- honestly the simulator cannot hand the body to the webhook; it has to park
-- it somewhere the webhook does not read, exactly as Resend does. That is this
-- table. `fail_fetches_remaining` lets a test force step two to fail N times
-- and prove the retry queue actually retries.
--
-- Dev only: RLS on, zero policies, service_role reaches it and nobody else.

create table if not exists public.dev_inbound_bodies (
  provider_email_id      text primary key,
  from_email             text not null,
  to_emails              text[] not null default '{}',
  cc_emails              text[] not null default '{}',
  subject                text,
  raw_text               text,
  raw_html               text,
  headers_json           jsonb not null default '{}'::jsonb,
  fail_fetches_remaining int  not null default 0,
  fetch_count            int  not null default 0,
  created_at             timestamptz not null default now()
);

alter table public.dev_inbound_bodies enable row level security;

comment on table public.dev_inbound_bodies is
  'Dev-only staging for simulated inbound bodies. Service role only; no policies by design.';

revoke all on public.dev_inbound_bodies from anon, authenticated;
