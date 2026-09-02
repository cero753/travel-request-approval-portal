import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import {
  extractRefToken,
  extractReplyKeyFromAddresses,
  normaliseAddress,
  parseMessageIds,
} from './address';

/**
 * Works out which travel request an inbound email is answering.
 *
 * Four strategies, tried in descending order of confidence. More than one
 * exists because plus-addressing cannot be relied on: some corporate gateways
 * rewrite or strip the local-part tag, and Resend's catch-all behaviour was not
 * confirmable from public docs at build time. Rather than bet the flow on it,
 * each strategy degrades to the next.
 *
 * The function never guesses. If nothing matches, the caller sends a
 * clarification instead of touching a request.
 */

export type MatchStrategy = 'plus_address' | 'ref_token' | 'in_reply_to' | 'subject_sender';

export interface MatchInput {
  toAddresses: string[];
  ccAddresses: string[];
  receivedFor: string | null;
  rawText: string | null;
  rawHtml: string | null;
  inReplyTo: string | null;
  references: string | null;
  subject: string | null;
  fromAddress: string | null;
}

export interface MatchResult {
  requestId: string | null;
  strategy: MatchStrategy | null;
  /** Why nothing matched, for the audit row and the clarification email. */
  reason: string;
}

export async function matchRequest(
  supabase: SupabaseClient<Database>,
  input: MatchInput,
): Promise<MatchResult> {
  // --- 1. plus address -----------------------------------------------------
  // Highest confidence: the key is a 80-bit random value we minted, and it
  // arrived on the envelope rather than in body text anyone could paste.
  const candidates = [input.receivedFor, ...input.toAddresses, ...input.ccAddresses].filter(
    (a): a is string => !!a,
  );
  const plusKey = extractReplyKeyFromAddresses(candidates);
  if (plusKey) {
    const id = await findByReplyKey(supabase, plusKey);
    if (id) return { requestId: id, strategy: 'plus_address', reason: `plus tag ${plusKey}` };
  }

  // --- 2. Ref: TRQ-<key> in the body --------------------------------------
  // Scanned against the RAW body, quotes included: the token lives in our own
  // footer, so finding it inside the quoted original is the expected case, not
  // a leak. Roughly 95% of replies quote, which makes this the most durable
  // key available when the envelope has been rewritten.
  const refKey = extractRefToken(input.rawText, input.rawHtml, input.subject);
  if (refKey) {
    const id = await findByReplyKey(supabase, refKey);
    if (id) return { requestId: id, strategy: 'ref_token', reason: `ref token ${refKey}` };
  }

  // --- 3. In-Reply-To / References ----------------------------------------
  const messageIds = [
    ...parseMessageIds(input.inReplyTo),
    ...parseMessageIds(input.references),
  ].map((id) => `<${id}>`);

  if (messageIds.length > 0) {
    const { data } = await supabase
      .from('email_events')
      .select('request_id')
      .in('message_id_header', messageIds)
      .not('request_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    const id = data?.[0]?.request_id ?? null;
    if (id) return { requestId: id, strategy: 'in_reply_to', reason: 'threaded by message id' };
  }

  // --- 4. subject + sender -------------------------------------------------
  // Weakest by far, so it is allowed to fire only when the answer is
  // unambiguous: exactly one request is pending for this manager. Two pending
  // requests and we abandon rather than pick one, because approving the wrong
  // trip is worse than asking.
  const from = normaliseAddress(input.fromAddress);
  if (from) {
    const { data } = await supabase
      .from('travel_requests')
      .select('id')
      .eq('manager_email', from)
      .eq('status', 'PENDING_APPROVAL')
      .limit(2);

    if (data?.length === 1) {
      return {
        requestId: data[0].id,
        strategy: 'subject_sender',
        reason: 'only one request pending for this manager',
      };
    }
    if (data && data.length > 1) {
      return {
        requestId: null,
        strategy: null,
        reason: 'multiple requests pending for this manager and no reply key in the message',
      };
    }
  }

  return { requestId: null, strategy: null, reason: 'no reply key, thread id or unique pending request' };
}

async function findByReplyKey(
  supabase: SupabaseClient<Database>,
  replyKey: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('travel_requests')
    .select('id')
    .eq('reply_key', replyKey)
    .maybeSingle();
  return data?.id ?? null;
}
