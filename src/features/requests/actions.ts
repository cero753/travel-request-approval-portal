'use server';

import { revalidatePath } from 'next/cache';
import { serverEnv } from '@/lib/env';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendApprovalRequestEmail, sendDecisionNoticeEmail } from '@/features/notifications/send';
import { draftSchema, travelRequestSchema } from './schema';

/**
 * Server actions for the request lifecycle.
 *
 * Two clients are in play and the split is deliberate:
 *
 *  - the **user-scoped** client writes drafts, so RLS decides what this person
 *    may touch. If the authorisation checks below were ever bypassed, the
 *    database would still refuse.
 *  - the **service** client only ever calls the SECURITY DEFINER transition
 *    functions, which are revoked from `authenticated` precisely so that the
 *    status column has exactly one writer.
 *
 * No action trusts an id from the client without re-reading the row it names.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

type SaveMode = 'draft' | 'submit';

async function persist(
  mode: SaveMode,
  raw: unknown,
  requestId: string | null,
): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Your session has expired. Sign in again.');

  const schema = mode === 'submit' ? travelRequestSchema : draftSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return fail('Some fields need attention.', fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createClient();

  // Resolve the project id alongside the code so Finance can join on it later.
  let projectId: string | null = null;
  if (input.billTo === 'PROJECT' && input.projectCode) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('code', input.projectCode.trim())
      .maybeSingle();
    projectId = project?.id ?? null;
  }

  const scalars = {
    from_city: emptyToNull(input.fromCity),
    to_city: emptyToNull(input.toCity),
    departure_date: emptyToNull(input.departureDate),
    return_date: emptyToNull(input.returnDate),
    mode: (emptyToNull(input.mode) as never) ?? null,
    purpose: emptyToNull(input.purpose),
    bill_to: (emptyToNull(input.billTo) as never) ?? null,
    project_code: input.billTo === 'PROJECT' ? emptyToNull(input.projectCode) : null,
    project_id: input.billTo === 'PROJECT' ? projectId : null,
    manager_email: emptyToNull(input.managerEmail),
    currency: input.currency ?? 'INR',
  };

  let id = requestId;

  if (id) {
    // Re-read rather than trusting the id: this both confirms ownership and
    // refuses to edit anything that has left DRAFT (PRD 4.7).
    const { data: existing } = await supabase
      .from('travel_requests')
      .select('id, requester_id, status')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return fail('That request no longer exists.');
    if (existing.requester_id !== user.id) return fail('That request belongs to someone else.');
    if (existing.status !== 'DRAFT') return fail('A submitted request can no longer be edited.');

    const { error } = await supabase.from('travel_requests').update(scalars).eq('id', id);
    if (error) return fail(friendly(error.message));
  } else {
    const { data: created, error } = await supabase
      .from('travel_requests')
      .insert({ ...scalars, requester_id: user.id, status: 'DRAFT' })
      .select('id')
      .single();
    if (error || !created) return fail(friendly(error?.message ?? 'Could not create the request.'));
    id = created.id;
  }

  // Children are rewritten wholesale. Diffing them would be more code for no
  // user-visible gain, and the total is recomputed by a trigger either way.
  await supabase.from('booking_links').delete().eq('request_id', id);
  await supabase.from('expense_items').delete().eq('request_id', id);

  const links = (input.bookingLinks ?? []).filter((l) => l.url.trim());
  if (links.length) {
    const { error } = await supabase.from('booking_links').insert(
      links.map((l, position) => ({ request_id: id!, url: l.url.trim(), position })),
    );
    if (error) return fail(friendly(error.message));
  }

  const expenses = input.expenses ?? [];
  if (expenses.length) {
    const { error } = await supabase.from('expense_items').insert(
      expenses.map((e, position) => ({
        request_id: id!,
        category: e.category,
        amount: e.amount,
        currency: input.currency ?? 'INR',
        description: emptyToNull(e.description),
        position,
      })),
    );
    if (error) return fail(friendly(error.message));
  }

  revalidatePath('/requests');
  revalidatePath(`/requests/${id}`);
  return { ok: true, data: { id } };
}

export async function saveDraftAction(
  raw: unknown,
  requestId: string | null,
): Promise<ActionResult<{ id: string }>> {
  return persist('draft', raw, requestId);
}

/**
 * Save, transition, and mail the manager — in that order.
 *
 * The email is sent *after* `submit_request` returns, never before. Sending
 * first would mean a failed transition still put an approvable link in a
 * manager's inbox.
 */
export async function submitRequestAction(
  raw: unknown,
  requestId: string | null,
): Promise<ActionResult<{ id: string }>> {
  const saved = await persist('submit', raw, requestId);
  if (!saved.ok) return saved;

  const user = await getSessionUser();
  if (!user) return fail('Your session has expired. Sign in again.');

  const service = createServiceClient();
  const { data, error } = await service.rpc('submit_request', {
    p_request_id: saved.data.id,
    p_actor_email: user.email,
    p_expiry_days: serverEnv().REQUEST_EXPIRY_DAYS,
  });

  if (error) return fail(`Could not submit: ${error.message}`);

  const result = data?.[0];
  if (!result?.ok) return fail(explainSubmit(result?.error_code ?? 'unknown'));

  const sent = await sendApprovalRequestEmail(saved.data.id);

  revalidatePath('/requests');
  revalidatePath(`/requests/${saved.data.id}`);
  revalidatePath('/approvals');

  if (!sent) {
    // The request IS submitted; only the mail failed. Saying "submitted" and
    // hiding that would be the worst of both — the manager never hears, and the
    // requester thinks they did.
    return fail(
      'The request was submitted, but the approval email could not be sent. Use "Resend approval email" on the request.',
    );
  }

  return { ok: true, data: { id: saved.data.id } };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function cancelRequestAction(requestId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail('Your session has expired. Sign in again.');

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select('id, requester_id')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return fail('That request no longer exists.');
  if (request.requester_id !== user.id) return fail('Only the requester can cancel a request.');

  const { data, error } = await createServiceClient().rpc('cancel_request', {
    p_request_id: requestId,
    p_actor_email: user.email,
  });
  if (error) return fail(error.message);
  if (!data?.[0]?.applied) {
    return fail(`This request is ${labelStatus(data?.[0]?.final_status)} and cannot be cancelled.`);
  }

  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true, data: undefined };
}

/**
 * PRD 4.6's "the requester may duplicate and resubmit" — the expired original
 * stays immutable, which is what makes the audit trail worth keeping.
 */
export async function duplicateRequestAction(
  requestId: string,
): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail('Your session has expired. Sign in again.');

  const supabase = await createClient();
  const { data: source } = await supabase
    .from('travel_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (!source) return fail('That request no longer exists.');
  if (source.requester_id !== user.id) return fail('That request belongs to someone else.');

  // Fetched separately rather than as an embedded select: the generated types
  // carry no relationship metadata, so PostgREST embedding would be untyped.
  const [{ data: sourceLinks }, { data: sourceExpenses }] = await Promise.all([
    supabase.from('booking_links').select('url, position').eq('request_id', requestId),
    supabase
      .from('expense_items')
      .select('category, amount, currency, description, position')
      .eq('request_id', requestId),
  ]);

  const { data: clone, error } = await supabase
    .from('travel_requests')
    .insert({
      requester_id: user.id,
      status: 'DRAFT',
      from_city: source.from_city,
      to_city: source.to_city,
      departure_date: source.departure_date,
      return_date: source.return_date,
      mode: source.mode,
      purpose: source.purpose,
      bill_to: source.bill_to,
      project_code: source.project_code,
      project_id: source.project_id,
      manager_email: source.manager_email,
      currency: source.currency,
      cloned_from_id: source.id,
    })
    .select('id')
    .single();

  if (error || !clone) return fail(friendly(error?.message ?? 'Could not duplicate.'));

  const links = sourceLinks ?? [];
  if (links.length) {
    await supabase
      .from('booking_links')
      .insert(links.map((l) => ({ request_id: clone.id, url: l.url, position: l.position })));
  }

  const expenses = sourceExpenses ?? [];
  if (expenses.length) {
    await supabase.from('expense_items').insert(
      expenses.map((e) => ({
        request_id: clone.id,
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        description: e.description,
        position: e.position,
      })),
    );
  }

  revalidatePath('/requests');
  return { ok: true, data: { id: clone.id } };
}

/** PRD 4.7: resend the approval email, rate-limited. */
export async function resendApprovalEmailAction(requestId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail('Your session has expired. Sign in again.');

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select('id, requester_id, manager_email, status, last_approval_email_at')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return fail('That request no longer exists.');

  const isRequester = request.requester_id === user.id;
  const isApprover = request.manager_email?.toLowerCase() === user.email.toLowerCase();
  if (!isRequester && !isApprover && user.role !== 'ADMIN') {
    return fail('You cannot resend this email.');
  }
  if (request.status !== 'PENDING_APPROVAL') {
    return fail('Only a pending request has an approval email to resend.');
  }

  // A resend button with no limit is a spam cannon pointed at one's own
  // manager, and a fast route to the sending domain being blocked.
  const last = request.last_approval_email_at ? new Date(request.last_approval_email_at) : null;
  const waited = last ? Date.now() - last.getTime() : Infinity;
  if (waited < 10 * 60 * 1000) {
    const minutes = Math.ceil((10 * 60 * 1000 - waited) / 60000);
    return fail(`That email went out recently. You can resend in ${minutes} minute(s).`);
  }

  const sent = await sendApprovalRequestEmail(requestId, { isReminder: true });
  if (!sent) return fail('The email could not be sent. Try again shortly.');

  revalidatePath(`/requests/${requestId}`);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Manager decision from inside the portal (PRD 4.5, channel PORTAL)
// ---------------------------------------------------------------------------

export async function decideInPortalAction(
  requestId: string,
  decision: 'APPROVED' | 'REJECTED',
  reason: string | null,
): Promise<ActionResult<{ applied: boolean; finalStatus: string | null }>> {
  const user = await getSessionUser();
  if (!user) return fail('Your session has expired. Sign in again.');

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select('id, manager_email, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return fail('That request no longer exists.');

  // Only the named approver. Finance can see everything and change nothing —
  // visibility and authority are different powers and are kept apart.
  if (request.manager_email?.toLowerCase() !== user.email.toLowerCase()) {
    return fail('Only the approving manager named on this request can decide it.');
  }

  const trimmed = reason?.trim() ?? '';
  if (decision === 'REJECTED' && trimmed.length < 3) {
    return fail('Give a reason for the rejection — the requester will see it.');
  }

  const { data, error } = await createServiceClient().rpc('decide_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_channel: 'PORTAL',
    p_actor_email: user.email,
    p_reason: trimmed || undefined,
  });

  if (error) return fail(error.message);

  const result = data?.[0];
  if (result?.applied) await sendDecisionNoticeEmail(requestId);

  revalidatePath('/approvals');
  revalidatePath('/requests');
  revalidatePath(`/requests/${requestId}`);

  if (!result?.applied) {
    return fail(
      `This request was already ${labelStatus(result?.final_status)} — your decision was not applied.`,
    );
  }

  return { ok: true, data: { applied: true, finalStatus: result.final_status } };
}

// ---------------------------------------------------------------------------

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function labelStatus(status: string | null | undefined): string {
  return (status ?? 'in another state').toLowerCase().replace('_', ' ');
}

function explainSubmit(code: string): string {
  return (
    {
      not_found: 'That request no longer exists.',
      not_draft: 'This request has already been submitted.',
      no_expense_items: 'Add at least one estimated cost before submitting.',
      no_booking_links: 'Add at least one booking link before submitting.',
    }[code] ?? `Could not submit the request (${code}).`
  );
}

/** Turns the more common constraint names into something a human can act on. */
function friendly(message: string): string {
  if (message.includes('chk_cities_differ')) return 'Origin and destination cannot be the same city.';
  if (message.includes('chk_return_after_departure')) return 'The return date cannot be before departure.';
  if (message.includes('chk_project_pairing')) return 'A project ID is required when billing to a project.';
  if (message.includes('chk_booking_url')) return 'Booking links must be http:// or https:// URLs.';
  if (message.includes('one currency')) return 'All estimated costs must use the same currency.';
  return message;
}
