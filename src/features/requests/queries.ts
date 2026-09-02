import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/database.types';
import type { TravelRequestInput } from './schema';

/**
 * Read-side helpers shared by the requester, approver and finance pages.
 *
 * Every function here uses the **user-scoped** client, so RLS is doing the
 * filtering and a page that forgets an `.eq()` returns nothing rather than
 * everything. The role checks in the page components are for the message the
 * user sees; this is where the actual boundary lives.
 */

export type RequestRow = Tables<'travel_requests'>;
export type ExpenseRow = Tables<'expense_items'>;
export type LinkRow = Tables<'booking_links'>;
export type AttachmentRow = Tables<'attachments'>;
export type AuditRow = Tables<'audit_log'>;

export interface RequestListItem {
  id: string;
  status: RequestRow['status'];
  fromCity: string | null;
  toCity: string | null;
  departureDate: string | null;
  returnDate: string | null;
  totalAmount: number;
  currency: string;
  billToDisplay: string | null;
  managerEmail: string | null;
  requesterName: string;
  requesterEmail: string;
  submittedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

const LIST_COLUMNS =
  'id, status, from_city, to_city, departure_date, return_date, total_amount, currency, bill_to_display, manager_email, requester_id, submitted_at, expires_at, updated_at';

/** Requests owned by `userId`, newest activity first. */
export async function listMyRequests(userId: string): Promise<RequestListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('travel_requests')
    .select(LIST_COLUMNS)
    .eq('requester_id', userId)
    .order('updated_at', { ascending: false });

  return decorate(data ?? []);
}

/** Requests awaiting *this* manager, oldest first — the longest wait is the most urgent. */
export async function listAwaitingMe(email: string): Promise<RequestListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('travel_requests')
    .select(LIST_COLUMNS)
    .eq('manager_email', email.toLowerCase())
    .eq('status', 'PENDING_APPROVAL')
    .order('submitted_at', { ascending: true });

  return decorate(data ?? []);
}

/** Everything this manager has already decided, for the "Decided" tab. */
export async function listDecidedByMe(email: string): Promise<RequestListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('travel_requests')
    .select(LIST_COLUMNS)
    .eq('manager_email', email.toLowerCase())
    .in('status', ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'])
    .order('updated_at', { ascending: false })
    .limit(200);

  return decorate(data ?? []);
}

export interface FinanceFilters {
  status?: string;
  billTo?: string;
  from?: string;
  to?: string;
  q?: string;
}

/** PRD 4.8 — Finance sees every request, with filters. Read-only by design. */
export async function listAllRequests(filters: FinanceFilters): Promise<RequestListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('travel_requests')
    .select(LIST_COLUMNS)
    .neq('status', 'DRAFT')
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(1000);

  if (filters.status) query = query.eq('status', filters.status as RequestRow['status']);
  if (filters.billTo) query = query.eq('bill_to', filters.billTo as 'AWIGN' | 'PROJECT');
  if (filters.from) query = query.gte('departure_date', filters.from);
  if (filters.to) query = query.lte('departure_date', filters.to);

  const { data } = await query;
  let rows = await decorate(data ?? []);

  // Free-text search runs here rather than in SQL: the candidate set is already
  // bounded above, and matching the requester's *name* means joining profiles
  // anyway. A trigram index is the right answer at 100k rows, not at 1k.
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.fromCity, r.toCity, r.requesterName, r.requesterEmail, r.managerEmail, r.billToDisplay]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }

  return rows;
}

export interface RequestDetail {
  request: RequestRow;
  expenses: ExpenseRow[];
  links: LinkRow[];
  attachments: AttachmentRow[];
  audit: AuditRow[];
  requesterName: string;
  requesterEmail: string;
}

/** Full detail, or null when RLS says this user cannot see the row. */
export async function getRequestDetail(id: string): Promise<RequestDetail | null> {
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('travel_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!request) return null;

  const [expenses, links, attachments, audit, requester] = await Promise.all([
    supabase.from('expense_items').select('*').eq('request_id', id).order('position'),
    supabase.from('booking_links').select('*').eq('request_id', id).order('position'),
    supabase.from('attachments').select('*').eq('request_id', id).order('created_at'),
    supabase
      .from('audit_log')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', request.requester_id)
      .maybeSingle(),
  ]);

  return {
    request,
    expenses: expenses.data ?? [],
    links: links.data ?? [],
    attachments: attachments.data ?? [],
    audit: audit.data ?? [],
    requesterName: requester.data?.full_name ?? 'Unknown',
    requesterEmail: requester.data?.email ?? '',
  };
}

/** Shapes a stored request back into the form's own vocabulary. */
export function toFormDefaults(detail: RequestDetail): Partial<TravelRequestInput> {
  const { request, expenses, links } = detail;
  return {
    fromCity: request.from_city ?? '',
    toCity: request.to_city ?? '',
    departureDate: request.departure_date ?? '',
    returnDate: request.return_date ?? '',
    mode: request.mode ?? undefined,
    purpose: request.purpose ?? '',
    currency: (request.currency ?? 'INR') as TravelRequestInput['currency'],
    billTo: request.bill_to ?? 'AWIGN',
    projectCode: request.project_code ?? '',
    managerEmail: request.manager_email ?? '',
    bookingLinks: links.map((l) => ({ url: l.url })),
    expenses: expenses.map((e) => ({
      category: e.category,
      amount: Number(e.amount),
      description: e.description ?? '',
    })),
  };
}

export async function listActiveProjects(): Promise<Array<{ code: string; name: string }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('projects')
    .select('code, name')
    .eq('active', true)
    .order('code');
  return data ?? [];
}

/** The signed-in user's default approver, so the form is pre-filled. */
export async function getDefaultManagerEmail(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('manager_email')
    .eq('id', userId)
    .maybeSingle();
  return data?.manager_email ?? '';
}

// ---------------------------------------------------------------------------

type ListRow = Pick<
  RequestRow,
  | 'id'
  | 'status'
  | 'from_city'
  | 'to_city'
  | 'departure_date'
  | 'return_date'
  | 'total_amount'
  | 'currency'
  | 'bill_to_display'
  | 'manager_email'
  | 'requester_id'
  | 'submitted_at'
  | 'expires_at'
  | 'updated_at'
>;

/**
 * Attaches requester names in one round trip rather than N.
 *
 * PostgREST could embed `profiles(...)` here, but the trimmed generated types
 * carry `Relationships: []`, which makes embedded selects untyped — see the
 * same note in actions.ts.
 */
async function decorate(rows: ListRow[]): Promise<RequestListItem[]> {
  if (!rows.length) return [];

  const supabase = await createClient();
  const ids = [...new Set(rows.map((r) => r.requester_id))];
  const { data: people } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids);

  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    fromCity: r.from_city,
    toCity: r.to_city,
    departureDate: r.departure_date,
    returnDate: r.return_date,
    totalAmount: Number(r.total_amount ?? 0),
    currency: r.currency ?? 'INR',
    billToDisplay: r.bill_to_display,
    managerEmail: r.manager_email,
    requesterName: byId.get(r.requester_id)?.full_name ?? 'Unknown',
    requesterEmail: byId.get(r.requester_id)?.email ?? '',
    submittedAt: r.submitted_at,
    expiresAt: r.expires_at,
    updatedAt: r.updated_at,
  }));
}
