'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { consumeToken } from '@/lib/tokens';
import { createServiceClient } from '@/lib/supabase/service';
import { sendDecisionNoticeEmail } from '@/features/notifications/send';

/**
 * Redeeming a decision link (PRD 4.5, channel LINK).
 *
 * Deliberately **not** a route handler with a GET: this only ever runs from a
 * POST the manager submits. See `peekToken` for why a mutating GET would be a
 * live vulnerability rather than a style preference.
 *
 * There is no session here — the whole point is that a manager needs no
 * account. Authorisation is the token itself: 256 bits of randomness, stored
 * hashed, single-use, expiring with the request.
 */

export type DecisionOutcome =
  | { status: 'applied'; decision: 'APPROVED' | 'REJECTED'; requestId: string }
  | { status: 'already_decided'; finalStatus: string | null; requestId: string | null }
  | { status: 'invalid'; reason: string };

export async function decideByTokenAction(
  token: string,
  reason: string | null,
): Promise<DecisionOutcome> {
  if (!token) return { status: 'invalid', reason: 'That link is missing its token.' };

  const ip = await clientIp();

  const consumed = await consumeToken(token, ip);
  if (!consumed.ok || !consumed.requestId || !consumed.action) {
    return { status: 'invalid', reason: explainToken(consumed.errorCode) };
  }

  const decision = consumed.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const service = createServiceClient();

  // The actor is the address the link was mailed to, read from the request
  // rather than from anything the browser sent. Nobody is signed in here, and
  // an audit row with a blank actor would be worth very little.
  const { data: request } = await service
    .from('travel_requests')
    .select('manager_email')
    .eq('id', consumed.requestId)
    .maybeSingle();

  const { data, error } = await service.rpc('decide_request', {
    p_request_id: consumed.requestId,
    p_decision: decision,
    p_channel: 'LINK',
    p_actor_email: request?.manager_email ?? 'unknown@link',
    p_reason: reason?.trim() || undefined,
  });

  if (error) return { status: 'invalid', reason: error.message };

  const result = data?.[0];

  revalidatePath('/requests');
  revalidatePath('/approvals');
  revalidatePath(`/requests/${consumed.requestId}`);

  if (!result?.applied) {
    // The token was single-use and is now spent, which is correct: it did get
    // used. The request simply was not pending any more — a reply had already
    // landed, or it expired. The status guard, not the token, is the authority.
    return {
      status: 'already_decided',
      finalStatus: result?.final_status ?? null,
      requestId: consumed.requestId,
    };
  }

  await sendDecisionNoticeEmail(consumed.requestId);

  return { status: 'applied', decision, requestId: consumed.requestId };
}

function explainToken(code: string | null): string {
  return (
    {
      not_found: 'That link is not valid. It may have been mistyped or already replaced.',
      already_used: 'That link has already been used. A decision was recorded.',
      expired: 'That link has expired. The request is no longer awaiting a decision.',
    }[code ?? ''] ?? 'That link could not be used.'
  );
}

/**
 * Best-effort client IP for the token audit row. Proxy headers are spoofable,
 * so this is recorded as evidence to read later, never used to authorise.
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return h.get('x-real-ip');
}
