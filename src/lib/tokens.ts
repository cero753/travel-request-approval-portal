import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import type { Enums } from '@/lib/supabase/database.types';

/**
 * Approval links.
 *
 * The PRD asked for "HMAC or JWT". This uses an opaque 256-bit random token
 * with only `sha256(token + pepper)` stored, which is stronger for this job:
 *
 *   - revocable instantly (a decision revokes every outstanding token for the
 *     request); a self-contained JWT is valid until it expires, so a leaked
 *     link keeps working after the request is already decided
 *   - no signing key to rotate, and no `alg: none` / signature-stripping bug
 *     class to get wrong
 *   - a database dump alone does not yield working links, because the pepper
 *     lives in the environment, not the table
 *
 * The cost is a database round trip per click. That is irrelevant at this
 * volume.
 */

const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash('sha256')
    .update(`${token}${serverEnv().TOKEN_PEPPER}`)
    .digest('hex');
}

export interface IssuedTokens {
  approveToken: string;
  rejectToken: string;
  approveUrl: string;
  rejectUrl: string;
}

/**
 * Mints one approve and one reject token, both expiring exactly when the
 * request does.
 *
 * Equal expiry is deliberate. If a token outlived its request, a click on day
 * eight would consume a valid token against an already-expired request and the
 * two systems would disagree about what happened. Instead the request status is
 * the single authority, and the token can never be the reason a late click
 * succeeds.
 */
export async function issueApprovalTokens(
  requestId: string,
  expiresAt: string,
): Promise<IssuedTokens> {
  const supabase = createServiceClient();

  const approveToken = randomBytes(TOKEN_BYTES).toString('base64url');
  const rejectToken = randomBytes(TOKEN_BYTES).toString('base64url');

  const { error } = await supabase.from('approval_tokens').insert([
    { request_id: requestId, action: 'APPROVE', token_hash: hashToken(approveToken), expires_at: expiresAt },
    { request_id: requestId, action: 'REJECT', token_hash: hashToken(rejectToken), expires_at: expiresAt },
  ]);
  if (error) throw new Error(`Could not issue approval tokens: ${error.message}`);

  return {
    approveToken,
    rejectToken,
    approveUrl: buildTokenUrl('approve', approveToken),
    rejectUrl: buildTokenUrl('reject', rejectToken),
  };
}

export function buildTokenUrl(action: 'approve' | 'reject', token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base}/${action}?token=${encodeURIComponent(token)}`;
}

export interface PeekedToken {
  requestId: string;
  action: Enums<'token_action'>;
  used: boolean;
  expired: boolean;
}

/**
 * Looks a token up **without redeeming it**.
 *
 * This is what makes the confirmation page safe to GET. Outlook Safe Links,
 * corporate mail scanners and Gmail's image proxy all fetch URLs found in mail
 * before a human ever sees them; if the GET consumed the token, every approval
 * link would be spent — and the decision applied — the moment the message
 * arrived. Reading is idempotent, so a scanner can hit this all day.
 */
export async function peekToken(token: string): Promise<PeekedToken | null> {
  const { data } = await createServiceClient()
    .from('approval_tokens')
    .select('request_id, action, used_at, expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!data) return null;

  return {
    requestId: data.request_id,
    action: data.action,
    used: data.used_at !== null,
    expired: new Date(data.expires_at).getTime() < Date.now(),
  };
}

export interface ConsumeResult {
  ok: boolean;
  errorCode: string | null;
  requestId: string | null;
  action: Enums<'token_action'> | null;
}

/**
 * Redeems a token. Single-use is enforced by the database
 * (`UPDATE ... WHERE used_at IS NULL ... RETURNING`), not by a read-then-write
 * here, so two simultaneous clicks cannot both win.
 */
export async function consumeToken(token: string, ip: string | null): Promise<ConsumeResult> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('consume_approval_token', {
    p_token_hash: hashToken(token),
    p_ip: ip ?? undefined,
  });

  if (error) throw new Error(`Token redemption failed: ${error.message}`);

  const row = data?.[0];
  if (!row) return { ok: false, errorCode: 'unknown', requestId: null, action: null };

  return {
    ok: row.ok,
    errorCode: row.error_code ?? null,
    requestId: row.request_id ?? null,
    action: row.action ?? null,
  };
}

/**
 * Constant-time secret comparison for the cron routes. `===` on strings leaks
 * the length of the matching prefix through timing; over enough requests that
 * is enough to recover the secret one character at a time.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself be a signal.
  // Hashing first makes both sides fixed-length.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
