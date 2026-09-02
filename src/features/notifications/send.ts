import 'server-only';

import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { publicEnv, serverEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { sendAndRecord } from '@/lib/email';
import { buildRefToken, buildReplyAddress } from '@/lib/email/address';
import { issueApprovalTokens } from '@/lib/tokens';
import { formatDateOnly, formatMoney } from '@/lib/utils';
import { ApprovalRequestEmail } from '@/emails/approval-request';
import { ClarificationEmail, DecisionNoticeEmail, ExpiryNoticeEmail } from '@/emails/notices';
import type { Tables } from '@/lib/supabase/database.types';

/**
 * Every outbound email in the system is built here.
 *
 * Templates stay pure React; this module owns the data loading, the reply
 * address, the token minting and the audit record. Keeping those four together
 * is deliberate — a template that could reach the database would eventually
 * mint a token as a side effect of rendering, and rendering happens in tests.
 */

type Request = Tables<'travel_requests'>;

interface Context {
  request: Request;
  requesterName: string;
  requesterEmail: string;
  expenses: Array<{ category: string; description: string | null; amount: string }>;
  bookingLinks: string[];
  attachmentCount: number;
  route: string;
  dates: string;
  totalFormatted: string;
  portalUrl: string;
  refToken: string;
  replyTo: string;
}

async function loadContext(requestId: string): Promise<Context | null> {
  const supabase = createServiceClient();

  const { data: request } = await supabase
    .from('travel_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return null;

  const [{ data: profile }, { data: expenses }, { data: links }, { count }] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', request.requester_id).maybeSingle(),
    supabase
      .from('expense_items')
      .select('category, description, amount')
      .eq('request_id', requestId)
      .order('position'),
    supabase.from('booking_links').select('url').eq('request_id', requestId).order('position'),
    supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      .eq('request_id', requestId),
  ]);

  const currency = request.currency ?? 'INR';

  return {
    request,
    requesterName: profile?.full_name ?? profile?.email ?? 'A colleague',
    requesterEmail: profile?.email ?? '',
    expenses: (expenses ?? []).map((e) => ({
      category: e.category,
      description: e.description,
      amount: formatMoney(Number(e.amount), currency),
    })),
    bookingLinks: (links ?? []).map((l) => l.url),
    attachmentCount: count ?? 0,
    route: `${request.from_city ?? '?'} → ${request.to_city ?? '?'}`,
    dates: request.return_date
      ? `${formatDateOnly(request.departure_date)} – ${formatDateOnly(request.return_date)}`
      : `${formatDateOnly(request.departure_date)} (one way)`,
    totalFormatted: formatMoney(Number(request.total_amount ?? 0), currency),
    portalUrl: `${publicEnv().NEXT_PUBLIC_APP_URL}/requests/${requestId}`,
    refToken: buildRefToken(request.reply_key),
    replyTo: buildReplyAddress(serverEnv().EMAIL_REPLY_TO_BASE, request.reply_key),
  };
}

/** Renders once and returns both parts. Clients that reject HTML still get the ask. */
async function renderBoth(element: ReactElement) {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

// ---------------------------------------------------------------------------
// Approval request / reminder
// ---------------------------------------------------------------------------

/**
 * The manager email, and the reminder — the same message with a banner.
 *
 * Fresh tokens are minted on every send rather than reusing the first pair.
 * Reusing them would mean a reminder resurrects a link that may already have
 * leaked into a forwarded thread; minting new ones costs two rows and every
 * outstanding token is revoked the moment a decision lands anyway.
 */
export async function sendApprovalRequestEmail(
  requestId: string,
  { isReminder = false }: { isReminder?: boolean } = {},
): Promise<boolean> {
  const ctx = await loadContext(requestId);
  if (!ctx) return false;
  if (!ctx.request.manager_email) return false;
  if (!ctx.request.expires_at) return false;

  const tokens = await issueApprovalTokens(requestId, ctx.request.expires_at);

  const subject = `Travel approval needed: ${ctx.requesterName} — ${ctx.route} (${ctx.totalFormatted})`;

  const { html, text } = await renderBoth(
    ApprovalRequestEmail({
      requesterName: ctx.requesterName,
      fromCity: ctx.request.from_city ?? '?',
      toCity: ctx.request.to_city ?? '?',
      mode: ctx.request.mode ?? 'OTHER',
      departureDate: formatDateOnly(ctx.request.departure_date),
      returnDate: ctx.request.return_date ? formatDateOnly(ctx.request.return_date) : null,
      purpose: ctx.request.purpose ?? '—',
      billTo: ctx.request.bill_to_display ?? ctx.request.bill_to ?? '—',
      currency: ctx.request.currency ?? 'INR',
      totalFormatted: ctx.totalFormatted,
      expenses: ctx.expenses,
      bookingLinks: ctx.bookingLinks,
      attachmentCount: ctx.attachmentCount,
      approveUrl: tokens.approveUrl,
      rejectUrl: tokens.rejectUrl,
      portalUrl: ctx.portalUrl,
      expiresOn: formatDateOnly(ctx.request.expires_at),
      refToken: ctx.refToken,
      isReminder,
    }),
  );

  // Thread the reminder under the original so the manager sees one conversation
  // rather than two competing asks.
  const headers = isReminder ? await threadHeaders(requestId) : undefined;

  const sent = await sendAndRecord({
    to: ctx.request.manager_email,
    subject,
    html,
    text,
    replyTo: ctx.replyTo,
    headers,
    requestId,
    kind: isReminder ? 'REMINDER' : 'APPROVAL_REQUEST',
  });

  if (!sent) return false;

  const supabase = createServiceClient();
  await supabase
    .from('travel_requests')
    .update({
      approval_email_count: (ctx.request.approval_email_count ?? 0) + 1,
      last_approval_email_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  await supabase.from('audit_log').insert({
    request_id: requestId,
    event: isReminder ? 'email.reminder_sent' : 'email.approval_request_sent',
    actor_email: null,
    channel: 'SYSTEM',
    metadata_json: { to: ctx.request.manager_email, message_id: sent.messageIdHeader },
  });

  return true;
}

/** In-Reply-To/References pointing at the first approval mail for this request. */
async function threadHeaders(requestId: string): Promise<Record<string, string> | undefined> {
  const { data } = await createServiceClient()
    .from('email_events')
    .select('message_id_header')
    .eq('request_id', requestId)
    .eq('kind', 'APPROVAL_REQUEST')
    .not('message_id_header', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);

  const parent = data?.[0]?.message_id_header;
  return parent ? { 'In-Reply-To': parent, References: parent } : undefined;
}

// ---------------------------------------------------------------------------
// Decision notice (PRD AC 7)
// ---------------------------------------------------------------------------

export async function sendDecisionNoticeEmail(requestId: string): Promise<boolean> {
  const ctx = await loadContext(requestId);
  if (!ctx || !ctx.requesterEmail) return false;

  const decision = ctx.request.status;
  if (decision !== 'APPROVED' && decision !== 'REJECTED') return false;

  const { html, text } = await renderBoth(
    DecisionNoticeEmail({
      requesterName: ctx.requesterName,
      decision,
      decidedBy: ctx.request.decided_by_email ?? ctx.request.manager_email ?? 'your manager',
      decidedVia: describeChannel(ctx.request.decision_channel),
      reason: ctx.request.decision_reason,
      route: ctx.route,
      dates: ctx.dates,
      totalFormatted: ctx.totalFormatted,
      portalUrl: ctx.portalUrl,
      refToken: ctx.refToken,
    }),
  );

  const sent = await sendAndRecord({
    to: ctx.requesterEmail,
    subject: `Travel request ${decision === 'APPROVED' ? 'approved' : 'rejected'}: ${ctx.route} (${ctx.totalFormatted})`,
    html,
    text,
    requestId,
    kind: 'DECISION_NOTICE',
  });

  if (sent) {
    await createServiceClient().from('audit_log').insert({
      request_id: requestId,
      event: 'email.decision_notice_sent',
      channel: 'SYSTEM',
      metadata_json: { to: ctx.requesterEmail, decision },
    });
  }
  return !!sent;
}

function describeChannel(channel: string | null): string {
  switch (channel) {
    case 'EMAIL_REPLY':
      return 'email reply';
    case 'LINK':
      return 'approval link';
    case 'PORTAL':
      return 'the portal';
    case 'SYSTEM':
      return 'the system';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Clarification (PRD 4.5A)
// ---------------------------------------------------------------------------

export type ClarificationOutcome = 'sent' | 'capped' | 'failed' | 'no_request';

/**
 * Asks the manager to say it again, more plainly.
 *
 * Two guards, both about mail loops. The caller must refuse to clarify to a
 * detected auto-reply; this function additionally caps the count per request.
 * An out-of-office that answers our clarification with another out-of-office is
 * an infinite exchange between two robots, and that is how a sending domain
 * gets blocked.
 */
export async function sendClarificationEmail(
  requestId: string,
  whatTheySaid: string,
): Promise<ClarificationOutcome> {
  const ctx = await loadContext(requestId);
  if (!ctx || !ctx.request.manager_email || !ctx.request.expires_at) return 'no_request';

  const max = serverEnv().MAX_CLARIFICATIONS;
  const supabase = createServiceClient();

  // Conditional UPDATE, not read-then-write: two replies arriving together must
  // not both observe "count < max" and both send.
  const { data: claimed } = await supabase
    .from('travel_requests')
    .update({ clarification_count: (ctx.request.clarification_count ?? 0) + 1 })
    .eq('id', requestId)
    .eq('clarification_count', ctx.request.clarification_count ?? 0)
    .lt('clarification_count', max)
    .select('id')
    .maybeSingle();

  if (!claimed) {
    await supabase.from('audit_log').insert({
      request_id: requestId,
      event: 'clarification.suppressed',
      channel: 'EMAIL_REPLY',
      metadata_json: { reason: 'clarification cap reached or concurrent send', max },
    });
    return 'capped';
  }

  const tokens = await issueApprovalTokens(requestId, ctx.request.expires_at);

  const { html, text } = await renderBoth(
    ClarificationEmail({
      managerName: ctx.request.manager_email,
      requesterName: ctx.requesterName,
      route: ctx.route,
      totalFormatted: ctx.totalFormatted,
      whatTheySaid: whatTheySaid.trim().slice(0, 500),
      approveUrl: tokens.approveUrl,
      rejectUrl: tokens.rejectUrl,
      portalUrl: ctx.portalUrl,
      refToken: ctx.refToken,
    }),
  );

  const sent = await sendAndRecord({
    to: ctx.request.manager_email,
    subject: `Re: Travel approval needed: ${ctx.requesterName} — ${ctx.route} (${ctx.totalFormatted})`,
    html,
    text,
    replyTo: ctx.replyTo,
    headers: await threadHeaders(requestId),
    requestId,
    kind: 'CLARIFICATION',
  });

  await supabase.from('audit_log').insert({
    request_id: requestId,
    event: sent ? 'clarification.sent' : 'clarification.send_failed',
    actor_email: ctx.request.manager_email,
    channel: 'EMAIL_REPLY',
    metadata_json: { excerpt: whatTheySaid.trim().slice(0, 200) },
  });

  return sent ? 'sent' : 'failed';
}

// ---------------------------------------------------------------------------
// Expiry notice (PRD 4.6)
// ---------------------------------------------------------------------------

export async function sendExpiryNoticeEmail(requestId: string): Promise<boolean> {
  const ctx = await loadContext(requestId);
  if (!ctx || !ctx.requesterEmail) return false;

  const { html, text } = await renderBoth(
    ExpiryNoticeEmail({
      requesterName: ctx.requesterName,
      managerEmail: ctx.request.manager_email ?? 'your manager',
      route: ctx.route,
      dates: ctx.dates,
      totalFormatted: ctx.totalFormatted,
      portalUrl: ctx.portalUrl,
      refToken: ctx.refToken,
    }),
  );

  const sent = await sendAndRecord({
    to: ctx.requesterEmail,
    subject: `Travel request expired: ${ctx.route}`,
    html,
    text,
    requestId,
    kind: 'EXPIRY_NOTICE',
  });

  if (sent) {
    await createServiceClient().from('audit_log').insert({
      request_id: requestId,
      event: 'email.expiry_notice_sent',
      channel: 'SYSTEM',
      metadata_json: { to: ctx.requesterEmail },
    });
  }
  return !!sent;
}
