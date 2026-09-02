-- PRD 4.1: "Allow multiple links (add row)".
create table public.booking_links (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.travel_requests(id) on delete cascade,
  url        text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  -- Belt-and-braces against `javascript:` / `data:` payloads reaching an email
  -- client. The zod schema is the primary gate; this is the backstop.
  constraint chk_booking_url check (url ~* '^https?://[^\s<>"]+$' and length(url) <= 2048)
);
create index idx_booking_links_request on public.booking_links (request_id, position);

-- PRD 4.2 repeatable expense rows.
create table public.expense_items (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.travel_requests(id) on delete cascade,
  category    public.expense_category not null,
  amount      numeric(14,2) not null,
  currency    char(3) not null default 'INR',
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint chk_expense_amount check (amount >= 0 and amount < 1e12),
  constraint chk_expense_currency check (currency ~ '^[A-Z]{3}$')
);
create index idx_expense_items_request on public.expense_items (request_id, position);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.travel_requests(id) on delete cascade,
  file_name    text not null,
  storage_key  text not null unique,
  size_bytes   bigint not null,
  mime_type    text not null,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- PRD 4.1: PDF/image, max 10 MB each. Magic-byte sniffing happens server-side;
  -- this stops a bad row even if that check is bypassed.
  constraint chk_attachment_size check (size_bytes > 0 and size_bytes <= 10 * 1024 * 1024),
  constraint chk_attachment_mime check (
    mime_type in ('application/pdf','image/png','image/jpeg','image/webp','image/heic')
  )
);
create index idx_attachments_request on public.attachments (request_id);

-- ---------------------------------------------------------------------------
-- Keep travel_requests.total_amount authoritative.
--
-- The running total shown on the form is a UI convenience; the number that ends
-- up in the manager's email and in Finance's CSV is computed here, so a client
-- that lies about the total cannot get a cheaper number approved.
-- ---------------------------------------------------------------------------
create or replace function public.recalc_request_total()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_request_id uuid := coalesce(new.request_id, old.request_id);
  v_currency   char(3);
  v_distinct   integer;
begin
  select count(distinct currency) into v_distinct
    from public.expense_items where request_id = v_request_id;

  if v_distinct > 1 then
    raise exception 'All expense items on a request must share one currency (found % distinct)', v_distinct
      using errcode = 'check_violation';
  end if;

  select currency into v_currency
    from public.expense_items where request_id = v_request_id limit 1;

  update public.travel_requests r
     set total_amount = coalesce(
           (select sum(e.amount) from public.expense_items e where e.request_id = v_request_id), 0),
         currency = coalesce(v_currency, r.currency)
   where r.id = v_request_id;

  return null;
end;
$$;

create trigger trg_expense_items_recalc
  after insert or update or delete on public.expense_items
  for each row execute function public.recalc_request_total();
