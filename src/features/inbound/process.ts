import 'server-only';

import { devToolsEnabled } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { getEmailProvider } from '@/lib/email';
import { PermanentEmailError, TransientEmailError, type ReceivedEmail } from '@/lib/email/provider';
import {
  normaliseAddress,
  parseAuthenticationResults,
  passesSenderAuthentication,
  sameAddress,
} from '@/lib/email/address';
import { matchRequest } from '@/lib/email/match-request';
import { parseApprovalReply } from '@/lib/email/reply-parser';
import { sendClarificationEmail, sendDecisionNoticeEmail } from '@/features/notifications/send';

/**
 * Turns a staged inbound email into a decision, or into a reasoned refusal.
 *
 * The webhook route calls this inline after staging, and the retry cron calls
 * it again for anything left `PENDING`. It is therefore written to be safe to
 * run twice on the same row: every terminal path sets `process_status` away
 * from `PENDING`, and the actual decision is a conditional UPDATE inside
 * `decide_request`, so a double run cannot produce a double approval.
 *
 * Nothing here mutates a request until three separate checks agree: the message
 * resolves to exactly one request, the sender is that request's manager, and
 * the parser read an unambiguous verdict. Any one of them failing means an
 * audit row and, where it is safe, a clarification email — never a guess.
 */

/** Step two can fail for a while and still recover; eventually it cannot. */
const MAX_FETCH_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 30_000;

export type ProcessOutcome =
  | 'decided'
  | 'not_pending'
  | 'clarification_sent'
  | 'clarification_capped'
  | 'ignored'
  | 'retry_later'
  | 'failed'
  | 'already_processed'
  | 'not_found';

export interface ProcessResult {
  outcome: ProcessOutcome;
  detail: string;
  requestId?: string | null;
  verdict?: string | null;
}

export async function processInboundEmail(inboundId: string): Promise<ProcessResult> {
  const supabase = createServiceClient();

  const { data: row, error } = await supabase
    .from('inbound_emails')
    .select('*')
    .eq('id', inboundId)
    .maybeSingle();

  if (error) throw new Error(`Could not load inbound email ${inboundId}: ${error.message}`);
  if (!row) return { outcome: 'not_found', detail: `no inbound row ${inboundId}` };

  if (row.process_status !== 'PENDING') {
    return { outcome: 'already_processed', detail: `already ${row.process_status}` };
  }

  // --- step two: fetch the body -------------------------------------------
  let received: ReceivedEmail;

  if (row.fetch_status === 'FETCHED' && (row.raw_text || row.raw_html)) {
    received = {
      id: row.provider_email_id ?? '',
      from: row.from_email ?? '',
      to: row.to_emails ?? [],
      cc: row.cc_emails ?? [],
      subject: row.subject,
      text: row.raw_text,
      html: row.raw_html,
      headers: (row.headers_json as Record<string, string> | null) ?? {},
    };
  } else {
    if (!row.provider_email_id) {
      return finish(inboundId, 'IGNORED', 'webhook carried no provider email id', {
        fetchStatus: 'FAILED',
      });
    }

    try {
      received = await getEmailProvider().getReceivedEmail(row.provider_email_id);
    } catch (err) {
      return handleFetchFailure(inboundId, row.fetch_attempts ?? 0, err);
    }

    const headers = lowerKeys(received.headers);

    const { error: saveError } = await supabase
      .from('inbound_emails')
      .update({
        fetch_status: 'FETCHED',
        fetch_attempts: (row.fetch_attempts ?? 0) + 1,
        last_fetch_error: null,
        raw_text: received.text,
        raw_html: received.html,
        headers_json: headers,
        in_reply_to: headers['in-reply-to'] ?? null,
        references_header: headers['references'] ?? null,
        // The webhook only knows the envelope; the fetched message is the
        // authority on who actually sent it.
        from_email: normaliseAddress(received.from) ?? row.from_email,
        subject: received.subject ?? row.subject,
      })
      .eq('id', inboundId);

    if (saveError) throw new Error(`Could not persist fetched body: ${saveError.message}`);
    received.headers = headers;
  }

  const headers = lowerKeys(received.headers);
  const fromAddress = normaliseAddress(received.from) ?? row.from_email;

  // --- which request is this about? ---------------------------------------
  const match = await matchRequest(supabase, {
    toAddresses: [...(row.to_emails ?? []), ...normaliseList(received.to)],
    ccAddresses: [...(row.cc_emails ?? []), ...normaliseList(received.cc)],
    receivedFor: row.received_for,
    rawText: received.text,
    rawHtml: received.html,
    inReplyTo: headers['in-reply-to'] ?? row.in_reply_to,
    references: headers['references'] ?? row.references_header,
    subject: received.subject ?? row.subject,
    fromAddress,
  });

  if (!match.requestId) {
    await recordInbound(null, 'INBOUND_IGNORED', row, fromAddress, {
      reason: match.reason,
      stage: 'match',
    });
    await audit(null, 'inbound.unmatched', fromAddress, { reason: match.reason });
    return finish(inboundId, 'IGNORED', `unmatched: ${match.reason}`, { strategy: null });
  }

  const requestId = match.requestId;

  const { data: request } = await supabase
    .from('travel_requests')
    .select('id, manager_email, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) {
    return finish(inboundId, 'IGNORED', 'matched request disappeared', { requestId });
  }

  // --- is this really the manager? ----------------------------------------
  //
  // Two independent questions. The first is "does the From address equal the
  // manager we mailed" — cheap, and catches a colleague replying on the CC
  // line. The second is "is that From address even real" — without it the first
  // check is worthless, because From is trivially forged.
  //
  // Accepted limitation: a manager who forwards the mail to an assistant to
  // action is rejected. That is the correct trade for a spend control; the
  // portal and the tokenised links cover that case.
  if (!sameAddress(fromAddress, request.manager_email)) {
    const detail = `sender ${fromAddress ?? 'unknown'} is not the approver ${request.manager_email}`;
    await recordInbound(requestId, 'INBOUND_IGNORED', row, fromAddress, {
      reason: detail,
      stage: 'sender',
    });
    await audit(requestId, 'inbound.sender_mismatch', fromAddress, {
      expected: request.manager_email,
      got: fromAddress,
      strategy: match.strategy,
    });
    return finish(inboundId, 'IGNORED', detail, { requestId, strategy: match.strategy });
  }

  const auth = passesSenderAuthentication(
    parseAuthenticationResults(headers['authentication-results']),
    // The local simulator has no DNS to be judged by, so a missing header is
    // tolerated only when the dev tools are explicitly on. In production an
    // absent Authentication-Results is a failure, not a shrug.
    { allowMissing: devToolsEnabled() },
  );

  if (!auth.ok) {
    await recordInbound(requestId, 'INBOUND_IGNORED', row, fromAddress, {
      reason: auth.reason,
      stage: 'authentication',
    });
    await audit(requestId, 'inbound.authentication_failed', fromAddress, { reason: auth.reason });
    return finish(inboundId, 'IGNORED', `sender authentication failed: ${auth.reason}`, {
      requestId,
      strategy: match.strategy,
    });
  }

  // --- what did they say? --------------------------------------------------
  const parsed = parseApprovalReply({
    text: received.text,
    html: received.html,
    subject: received.subject ?? row.subject,
    headers,
  });

  await recordInbound(requestId, 'INBOUND_REPLY', row, fromAddress, {
    verdict: parsed.verdict,
    rule: parsed.matchedRule,
    confidence: parsed.confidence,
    strategy: match.strategy,
    auto_reply: parsed.isAutoReply,
  });

  if (parsed.verdict === 'approve' || parsed.verdict === 'reject') {
    const decision = parsed.verdict === 'approve' ? 'APPROVED' : 'REJECTED';

    const { data: result, error: rpcError } = await supabase.rpc('decide_request', {
      p_request_id: requestId,
      p_decision: decision,
      p_channel: 'EMAIL_REPLY',
      p_actor_email: fromAddress ?? request.manager_email ?? '',
      p_reason: parsed.reason ?? undefined,
    });

    if (rpcError) throw new Error(`decide_request failed: ${rpcError.message}`);

    const applied = result?.[0]?.applied === true;

    await audit(requestId, applied ? 'inbound.decision_applied' : 'inbound.decision_not_applied', fromAddress, {
      decision,
      matched_rule: parsed.matchedRule,
      matched_phrase: parsed.matchedPhrase,
      confidence: parsed.confidence,
      match_strategy: match.strategy,
      final_status: result?.[0]?.final_status ?? null,
      error_code: result?.[0]?.error_code ?? null,
    });

    if (applied) {
      // PRD AC 7. A failed notification must not undo a valid decision, so this
      // is fire-and-record: sendAndRecord writes SEND_FAILED and returns null.
      await sendDecisionNoticeEmail(requestId);
      return finish(inboundId, 'PROCESSED', `applied ${decision}`, {
        requestId,
        strategy: match.strategy,
        verdict: parsed.verdict,
        outcome: 'decided',
      });
    }

    // Lost a race with a link click, the portal, or the expiry job. The SQL
    // function has already written `decision.ignored_not_pending`.
    return finish(inboundId, 'PROCESSED', `not applied: ${result?.[0]?.error_code ?? 'unknown'}`, {
      requestId,
      strategy: match.strategy,
      verdict: parsed.verdict,
      outcome: 'not_pending',
    });
  }

  // --- unclear ------------------------------------------------------------
  if (parsed.isAutoReply) {
    await audit(requestId, 'inbound.auto_reply_ignored', fromAddress, {
      notes: parsed.notes,
    });
    return finish(inboundId, 'IGNORED', 'automated reply; no clarification sent', {
      requestId,
      strategy: match.strategy,
      verdict: parsed.verdict,
    });
  }

  if (request.status !== 'PENDING_APPROVAL') {
    await audit(requestId, 'inbound.reply_after_decision', fromAddress, {
      status: request.status,
      verdict: parsed.verdict,
    });
    return finish(inboundId, 'IGNORED', `request is ${request.status}; nothing to clarify`, {
      requestId,
      strategy: match.strategy,
      verdict: parsed.verdict,
    });
  }

  const outcome = await sendClarificationEmail(requestId, parsed.visibleText);

  return finish(
    inboundId,
    'PROCESSED',
    `${parsed.verdict}: clarification ${outcome}`,
    {
      requestId,
      strategy: match.strategy,
      verdict: parsed.verdict,
      outcome: outcome === 'sent' ? 'clarification_sent' : 'clarification_capped',
    },
  );
}

// ---------------------------------------------------------------------------
// Retry accounting
// ---------------------------------------------------------------------------

/**
 * Exponential backoff on transient failures, and a hard stop on permanent ones.
 *
 * The distinction matters: a 404 from the received-emails API means the id is
 * wrong and no number of retries will fix it, while a 5xx means the body is
 * probably there and we simply asked too early. Retrying the first forever
 * burns the queue; giving up on the second loses an approval.
 */
async function handleFetchFailure(
  inboundId: string,
  priorAttempts: number,
  err: unknown,
): Promise<ProcessResult> {
  const supabase = createServiceClient();
  const attempts = priorAttempts + 1;
  const message = err instanceof Error ? err.message : String(err);

  const permanent =
    err instanceof PermanentEmailError ||
    (!(err instanceof TransientEmailError) && !(err instanceof Error && 'transient' in err));

  if (permanent || attempts >= MAX_FETCH_ATTEMPTS) {
    await supabase
      .from('inbound_emails')
      .update({
        fetch_status: 'FAILED',
        fetch_attempts: attempts,
        last_fetch_error: message,
        process_status: 'FAILED',
        processed_at: new Date().toISOString(),
      })
      .eq('id', inboundId);

    await audit(null, 'inbound.fetch_gave_up', null, { inbound_id: inboundId, attempts, message });
    return { outcome: 'failed', detail: `giving up after ${attempts}: ${message}` };
  }

  const delay = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  await supabase
    .from('inbound_emails')
    .update({
      fetch_status: 'PENDING',
      fetch_attempts: attempts,
      last_fetch_error: message,
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
    })
    .eq('id', inboundId);

  return {
    outcome: 'retry_later',
    detail: `attempt ${attempts} failed, retrying in ${Math.round(delay / 1000)}s: ${message}`,
  };
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

interface FinishExtras {
  requestId?: string | null;
  strategy?: string | null;
  verdict?: string | null;
  fetchStatus?: string;
  outcome?: ProcessOutcome;
}

async function finish(
  inboundId: string,
  status: 'PROCESSED' | 'IGNORED' | 'FAILED',
  detail: string,
  extras: FinishExtras = {},
): Promise<ProcessResult> {
  await createServiceClient()
    .from('inbound_emails')
    .update({
      process_status: status,
      processed_at: new Date().toISOString(),
      matched_request_id: extras.requestId ?? null,
      match_strategy: extras.strategy ?? null,
      parse_verdict: extras.verdict ?? null,
      ignored_reason: status === 'PROCESSED' ? null : detail,
      ...(extras.fetchStatus ? { fetch_status: extras.fetchStatus } : {}),
    })
    .eq('id', inboundId);

  return {
    outcome: extras.outcome ?? (status === 'PROCESSED' ? 'decided' : status === 'IGNORED' ? 'ignored' : 'failed'),
    detail,
    requestId: extras.requestId ?? null,
    verdict: extras.verdict ?? null,
  };
}

type InboundRow = {
  subject: string | null;
  message_id_header: string | null;
  provider_email_id: string | null;
  svix_id: string;
};

async function recordInbound(
  requestId: string | null,
  type: 'INBOUND_REPLY' | 'INBOUND_IGNORED',
  row: InboundRow,
  fromAddress: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await createServiceClient().from('email_events').insert({
    request_id: requestId,
    type,
    from_email: fromAddress,
    subject: row.subject,
    message_id_header: row.message_id_header,
    provider_message_id: row.provider_email_id,
    payload_json: { ...payload, svix_id: row.svix_id },
  });
}

async function audit(
  requestId: string | null,
  event: string,
  actorEmail: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await createServiceClient().from('audit_log').insert({
    request_id: requestId,
    event,
    actor_email: actorEmail,
    channel: 'EMAIL_REPLY',
    metadata_json: metadata as never,
  });
}

function lowerKeys(headers: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = String(v ?? '');
  return out;
}

function normaliseList(values: string[] | null | undefined): string[] {
  return (values ?? []).map((v) => normaliseAddress(v)).filter((v): v is string => v !== null);
}
