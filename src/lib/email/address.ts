/**
 * Address and reference-token helpers. Pure and dependency-free so the unit
 * tests can hammer them without a database.
 */

/** `"Priya Sharma" <priya@x.com>` -> `priya@x.com`. Lowercased, trimmed. */
export function normaliseAddress(input: string | null | undefined): string | null {
  if (!input) return null;
  const angled = input.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : input).trim().toLowerCase();
  // Strip stray quoting and any trailing punctuation a header may carry.
  const cleaned = raw.replace(/^["'\s]+|["'\s,;]+$/g, '');
  return cleaned.includes('@') ? cleaned : null;
}

/** Splits a comma-separated header into normalised addresses, dropping junk. */
export function normaliseAddressList(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const parts = Array.isArray(input) ? input : splitAddressHeader(input);
  return parts.map(normaliseAddress).filter((a): a is string => a !== null);
}

/** Commas inside a quoted display name are not separators. */
function splitAddressHeader(header: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<') inAngle = true;
    else if (ch === '>') inAngle = false;
    if (ch === ',' && !inQuotes && !inAngle) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * Two addresses are the same mailbox.
 *
 * Deliberately does NOT treat `a+tag@x` as equal to `a@x` when comparing a
 * *sender* to an expected manager: plus-tags are user-controlled, and letting
 * them match would let anyone at the domain impersonate a colleague. Callers
 * that want the base mailbox ask for it explicitly via `stripPlusTag`.
 */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normaliseAddress(a);
  const nb = normaliseAddress(b);
  return na !== null && na === nb;
}

export function stripPlusTag(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return address;
  return `${local.split('+')[0]}@${domain}`;
}

/** `approvals@awign.com` + key -> `approvals+<key>@awign.com`. */
export function buildReplyAddress(base: string, replyKey: string): string {
  const [local, domain] = base.split('@');
  if (!domain) throw new Error(`EMAIL_REPLY_TO_BASE is not an address: ${base}`);
  return `${local.split('+')[0]}+${replyKey}@${domain}`;
}

/** The plus tag out of any of the recipient addresses, or null. */
export function extractReplyKeyFromAddresses(addresses: string[]): string | null {
  for (const address of addresses) {
    const match = address.match(/\+([a-f0-9]{20})@/i);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Every outbound approval mail carries `Ref: TRQ-<reply_key>` in its footer.
 * Around 95% of replies quote the original, so this token usually comes back
 * even when plus-addressing does not survive the round trip. It is scanned
 * against the RAW body — quoted text included — because being inside the quote
 * is precisely where we expect to find it.
 */
export const REF_PREFIX = 'TRQ-';

export function buildRefToken(replyKey: string): string {
  return `${REF_PREFIX}${replyKey}`;
}

export function extractRefToken(...bodies: Array<string | null | undefined>): string | null {
  for (const body of bodies) {
    if (!body) continue;
    // Mail clients wrap long lines and some insert soft hyphens or zero-width
    // characters at the wrap point, so strip those before matching.
    // ­ soft hyphen, ​-‏ zero-width + bidi marks, ⁠ word joiner,
    // ﻿ BOM. Written as escapes: invisible literals in source are a trap.
    const flattened = body.replace(/[­​-‏⁠﻿]/g, '');
    const match = flattened.match(/TRQ-([a-f0-9]{20})/i);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * `In-Reply-To` / `References` carry angle-bracketed message ids. References
 * holds the whole ancestry, newest last.
 */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Reads SPF/DKIM/DMARC results out of an `Authentication-Results` header.
 * Anything we cannot find comes back as null, and the caller decides — treating
 * "absent" as "pass" would defeat the whole check.
 */
export interface AuthResults {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

export function parseAuthenticationResults(header: string | null | undefined): AuthResults {
  const read = (name: string): string | null => {
    if (!header) return null;
    const m = header.match(new RegExp(`\\b${name}\\s*=\\s*([a-z]+)`, 'i'));
    return m ? m[1].toLowerCase() : null;
  };
  return { spf: read('spf'), dkim: read('dkim'), dmarc: read('dmarc') };
}

/**
 * Did this message actually come from who it says it did?
 *
 * DMARC pass is sufficient on its own — that is what DMARC means. Failing that,
 * SPF *and* DKIM both passing is accepted, which is the pre-DMARC equivalent.
 * Absent headers are never treated as a pass in production; in development the
 * simulator has no real DNS to check against, so the caller passes
 * `allowMissing`.
 */
export function passesSenderAuthentication(
  results: AuthResults,
  { allowMissing = false }: { allowMissing?: boolean } = {},
): { ok: boolean; reason: string } {
  if (results.dmarc === 'pass') return { ok: true, reason: 'dmarc=pass' };
  if (results.spf === 'pass' && results.dkim === 'pass') return { ok: true, reason: 'spf+dkim=pass' };

  const nothingPresent = !results.dmarc && !results.spf && !results.dkim;
  if (nothingPresent && allowMissing) {
    return { ok: true, reason: 'no authentication-results header (allowed in dev)' };
  }
  if (nothingPresent) {
    return { ok: false, reason: 'no authentication-results header' };
  }
  return {
    ok: false,
    reason: `dmarc=${results.dmarc ?? 'absent'} spf=${results.spf ?? 'absent'} dkim=${results.dkim ?? 'absent'}`,
  };
}
