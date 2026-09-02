-- ===========================================================================
-- Row Level Security.
--
-- Defence in depth. Every server action already authorises its caller, but if
-- a query ever escapes with the user's own token, RLS is what stops a
-- requester reading another team's spend. Tables with no policy at all
-- (approval_tokens, inbound_emails, dev_sent_emails) are readable ONLY by the
-- service role, which bypasses RLS by design.
--
-- auth.uid() is wrapped in a scalar subquery throughout: that makes Postgres
-- evaluate it once per statement instead of once per row.
-- ===========================================================================

create or replace function public.can_view_request(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.travel_requests r
     where r.id = p_request_id
       and (
            r.requester_id  = (select auth.uid())
         or r.manager_email = public.current_email()
         or public.is_finance()
       )
  );
$$;

alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.travel_requests enable row level security;
alter table public.booking_links   enable row level security;
alter table public.expense_items   enable row level security;
alter table public.attachments     enable row level security;
alter table public.approval_tokens enable row level security;
alter table public.email_events    enable row level security;
alter table public.audit_log       enable row level security;
alter table public.inbound_emails  enable row level security;
alter table public.dev_sent_emails enable row level security;

-- --- profiles --------------------------------------------------------------
create policy p_profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_finance());

-- Users may edit their own row but NOT their own role. The USING clause alone
-- would happily let a REQUESTER promote themselves to ADMIN; the WITH CHECK
-- re-reads the stored role and pins it.
create policy p_profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
  );

-- --- projects --------------------------------------------------------------
create policy p_projects_select on public.projects
  for select to authenticated
  using (active or public.is_finance());

create policy p_projects_write on public.projects
  for all to authenticated
  using (public.is_finance())
  with check (public.is_finance());

-- --- travel_requests -------------------------------------------------------
create policy p_requests_select on public.travel_requests
  for select to authenticated
  using (
       requester_id  = (select auth.uid())
    or manager_email = public.current_email()
    or public.is_finance()
  );

create policy p_requests_insert on public.travel_requests
  for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'DRAFT');

-- Editing is draft-only (PRD 4.7). Every post-draft transition goes through a
-- SECURITY DEFINER function instead, so there is no UPDATE path to APPROVED
-- available to a logged-in user.
create policy p_requests_update_draft on public.travel_requests
  for update to authenticated
  using (requester_id = (select auth.uid()) and status = 'DRAFT')
  with check (requester_id = (select auth.uid()) and status = 'DRAFT');

create policy p_requests_delete_draft on public.travel_requests
  for delete to authenticated
  using (requester_id = (select auth.uid()) and status = 'DRAFT');

-- --- child rows: visibility follows the parent request ---------------------
create policy p_booking_links_select on public.booking_links
  for select to authenticated using (public.can_view_request(request_id));
create policy p_booking_links_write on public.booking_links
  for all to authenticated
  using (exists (select 1 from public.travel_requests r
                  where r.id = request_id and r.requester_id = (select auth.uid())
                    and r.status = 'DRAFT'))
  with check (exists (select 1 from public.travel_requests r
                  where r.id = request_id and r.requester_id = (select auth.uid())
                    and r.status = 'DRAFT'));

create policy p_expense_items_select on public.expense_items
  for select to authenticated using (public.can_view_request(request_id));
create policy p_expense_items_write on public.expense_items
  for all to authenticated
  using (exists (select 1 from public.travel_requests r
                  where r.id = request_id and r.requester_id = (select auth.uid())
                    and r.status = 'DRAFT'))
  with check (exists (select 1 from public.travel_requests r
                  where r.id = request_id and r.requester_id = (select auth.uid())
                    and r.status = 'DRAFT'));

create policy p_attachments_select on public.attachments
  for select to authenticated using (public.can_view_request(request_id));
create policy p_attachments_write on public.attachments
  for all to authenticated
  using (exists (select 1 from public.travel_requests r
                  where r.id = request_id and r.requester_id = (select auth.uid())
                    and r.status = 'DRAFT'))
  with check (exists (select 1 from public.travel_requests r
                  where r.id = request_id and r.requester_id = (select auth.uid())
                    and r.status = 'DRAFT'));

-- --- read-only history -----------------------------------------------------
create policy p_email_events_select on public.email_events
  for select to authenticated using (public.can_view_request(request_id));

-- SELECT only, deliberately. PRD 4.8 requires an append-only trail, so no
-- INSERT/UPDATE/DELETE policy exists for any logged-in role: only the
-- SECURITY DEFINER transition functions can write here.
create policy p_audit_select on public.audit_log
  for select to authenticated using (public.can_view_request(request_id));

-- approval_tokens, inbound_emails and dev_sent_emails intentionally have RLS
-- enabled and ZERO policies -> unreachable except via the service role.

-- ---------------------------------------------------------------------------
-- Attachment storage. Private bucket; the app serves files through short-lived
-- signed URLs generated server-side after an authorisation check, so no
-- storage policy grants direct access to authenticated users.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
