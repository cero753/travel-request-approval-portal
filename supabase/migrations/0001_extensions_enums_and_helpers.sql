create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.app_role         as enum ('REQUESTER','MANAGER','FINANCE','ADMIN');
create type public.request_status   as enum ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED','EXPIRED');
create type public.travel_mode      as enum ('FLIGHT','TRAIN','BUS','CAB','OTHER');
create type public.bill_to_type     as enum ('AWIGN','PROJECT');
create type public.expense_category as enum ('TICKET','ACCOMMODATION','LOCAL_TRANSPORT','MEALS','OTHER');
create type public.decision_channel as enum ('EMAIL_REPLY','LINK','PORTAL','SYSTEM');
create type public.token_action     as enum ('APPROVE','REJECT');

-- Outbound + inbound mail lifecycle. Superset of PRD section 7 so provider webhooks map 1:1.
create type public.email_event_type as enum (
  'SENT','DELIVERED','BOUNCED','COMPLAINED','DELIVERY_DELAYED','SEND_FAILED',
  'INBOUND_REPLY','INBOUND_IGNORED','CLARIFICATION_SENT','REMINDER_SENT','NOTIFICATION_SENT'
);

-- Which template an outbound row came from; lets us rate-limit resends per kind.
create type public.email_kind as enum (
  'APPROVAL_REQUEST','REMINDER','CLARIFICATION','DECISION_NOTICE','EXPIRY_NOTICE'
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
