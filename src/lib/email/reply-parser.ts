/**
 * Approval-reply parser.
 *
 * This module decides whether a manager's email reply approves company spend.
 * It is pure and synchronous -- no I/O, no database, no clock -- so every
 * behaviour below is reachable from a unit test.
 *
 * Two principles drive the design:
 *
 * 1. A false APPROVE is far worse than a missed one. Anything the rules cannot
 *    read confidently returns `ambiguous` or `no_decision`, which sends the
 *    manager a clarification email. Nobody's money moves on a guess. There is
 *    deliberately NO fuzzy matching: "Approvedd" is not an approval.
 *
 * 2. Quoted text is hostile input. Our own outbound email contains the words
 *    "reply with Approved or Yes". That text comes back inside the quote of
 *    every reply, so a parser that scans the raw body approves everything --
 *    including "no". Quote stripping is a correctness requirement, not tidiness.
 */

export type Verdict = 'approve' | 'reject' | 'ambiguous' | 'no_decision';

export interface ParseInput {
  text?: string | null;
  html?: string | null;
  subject?: string | null;
  headers?: Record<string, string> | null;
}

export interface ParseResult {
  verdict: Verdict;
  /** 0..1. Only meaningful for approve/reject. */
  confidence: number;
  /** The exact substring that triggered the decision, for the audit log. */
  matchedPhrase: string | null;
  /** Stable rule id, e.g. "approve.explicit". */
  matchedRule: string | null;
  /** Free text the manager added, stored as decision_reason. */
  reason: string | null;
  /** Body after quote + signature stripping. Shown in /dev/mailbox. */
  visibleText: string;
  isAutoReply: boolean;
  /** Human-readable trace of what the parser did and why. */
  notes: string[];
}

type Family = 'approve' | 'reject';

interface Rule {
  id: string;
  family: Family;
  priority: number;
  re: RegExp;
  /** Only fires at the start of a meaningful line. */
  anchored?: boolean;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Outlook and mobile clients pepper bodies with non-breaking spaces, zero-width
 * joiners and bidi marks. "Approved ." must behave exactly like "Approved."
 */
function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿‎‏‪-‮⁠]/g, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[ \t]+\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Auto-reply detection
// ---------------------------------------------------------------------------

const AUTO_SUBJECT =
  /^\s*(?:automatic reply|auto(?:matic)?[- ]?reply|out of (?:the )?office|ooo\b|autoreply|auto:|undeliverable|delivery status notification|mail delivery (?:failed|subsystem)|returned mail)/i;

/**
 * An out-of-office whose body happens to contain "I have approved all pending
 * requests" must never approve anything. Header checks run first and are
 * authoritative; the subject check is a fallback for senders that omit them.
 */
function detectAutoReply(
  headers: Record<string, string> | null | undefined,
  subject: string | null | undefined,
): { isAuto: boolean; why: string | null } {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) h[k.toLowerCase()] = String(v ?? '');

  const autoSubmitted = h['auto-submitted'];
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') {
    return { isAuto: true, why: `Auto-Submitted: ${autoSubmitted}` };
  }
  const precedence = (h['precedence'] ?? '').trim().toLowerCase();
  if (['auto_reply', 'bulk', 'junk', 'list'].includes(precedence)) {
    return { isAuto: true, why: `Precedence: ${precedence}` };
  }
  for (const key of ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'x-mailer-daemon']) {
    if (h[key]) return { isAuto: true, why: `${key} present` };
  }
  if (h['list-id'] || h['list-unsubscribe']) {
    return { isAuto: true, why: 'mailing-list headers present' };
  }
  // A null Return-Path is the RFC 3834 marker for machine-generated mail.
  const returnPath = (h['return-path'] ?? '').trim();
  if (returnPath === '<>' || returnPath === '') {
    if (returnPath === '<>') return { isAuto: true, why: 'null Return-Path' };
  }
  if (subject && AUTO_SUBJECT.test(subject)) {
    return { isAuto: true, why: `subject looks automated: ${subject.trim().slice(0, 80)}` };
  }
  return { isAuto: false, why: null };
}

// ---------------------------------------------------------------------------
// HTML -> text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Removes whole `<blockquote>` subtrees, honouring nesting.
 *
 * This must happen BEFORE tags are flattened. Strip the tags first and the
 * quoted original becomes indistinguishable from what the manager actually
 * typed -- which is precisely how a parser ends up reading our own
 * "reply with Approved" instruction as the manager's decision.
 */
function removeBlockquotes(html: string): string {
  const open = /<blockquote\b[^>]*>/gi;
  let out = html;

  for (;;) {
    open.lastIndex = 0;
    const start = open.exec(out);
    if (!start) break;

    let depth = 1;
    const scan = /<(\/?)blockquote\b[^>]*>/gi;
    scan.lastIndex = start.index + start[0].length;
    let end = -1;

    for (;;) {
      const m = scan.exec(out);
      if (!m) break;
      depth += m[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    // Unbalanced markup: drop everything from the opening tag onward rather
    // than risk treating quoted content as fresh input.
    out = end === -1 ? out.slice(0, start.index) : out.slice(0, start.index) + out.slice(end);
  }
  return out;
}

/** Client-specific quote containers that are divs, not blockquotes. */
const QUOTE_CONTAINER =
  /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:gmail_quote|yahoo_quoted|moz-cite-prefix|OutlookMessageHeader|divRplyFwdMsg|x_gmail_quote)[^"']*["'][^>]*>/i;

export function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = removeBlockquotes(s);

  // Everything from a quote container to the end of the document is history.
  const q = s.match(QUOTE_CONTAINER);
  if (q && q.index !== undefined) s = s.slice(0, q.index);

  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<(p|div|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(s)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Quote stripping (plain text)
// ---------------------------------------------------------------------------

const QUOTE_MARKERS: RegExp[] = [
  /^\s*>/,
  /^\s*-{2,}\s*original message\s*-{2,}/i,
  /^\s*-{2,}\s*forwarded message\s*-{2,}/i,
  /^\s*_{10,}\s*$/,
  /^\s*-{10,}\s*$/,
  /^\s*on\b.{3,300}\bwrote\s*:\s*$/i,
  /^\s*on\b.{3,300}\b(?:a écrit|schrieb|escribió)\s*:\s*$/i,
  /^\s*le\b.{3,300}\ba écrit\s*:\s*$/i,
  /^\s*from\s*:\s*.+$/i,
  /^\s*sent\s*:\s*.+$/i,
  /^\s*\*?from\*?\s*:\s*.+$/i,
  /^\s*at\b.{3,200}\bwrote\s*:\s*$/i,
  /^\s*.{0,120}\bwrote\s*:\s*$/i,
];

/**
 * Truncates at the first line that begins quoted history.
 *
 * `On <date> X wrote:` is frequently wrapped across two or three lines by the
 * sending client, so candidate lines are re-tested joined with their
 * successors before being cleared.
 */
export function stripQuotedText(text: string): { visible: string; quoteStartedAt: number | null } {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      return { visible: lines.slice(0, i).join('\n'), quoteStartedAt: i };
    }

    // Wrapped attribution line: join up to two following lines and re-test.
    if (/^\s*(?:on|le|at)\b/i.test(line)) {
      const joined2 = `${line} ${(lines[i + 1] ?? '').trim()}`.trim();
      const joined3 = `${joined2} ${(lines[i + 2] ?? '').trim()}`.trim();
      if (/\bwrote\s*:\s*$/i.test(joined2) || /\bwrote\s*:\s*$/i.test(joined3)) {
        return { visible: lines.slice(0, i).join('\n'), quoteStartedAt: i };
      }
    }
  }
  return { visible: text, quoteStartedAt: null };
}

// ---------------------------------------------------------------------------
// Signature stripping
// ---------------------------------------------------------------------------

const SIG_HARD = [
  /^\s*--\s*$/,
  /^\s*__+\s*$/,
  /^\s*sent from my\b/i,
  /^\s*sent from\s+(?:my\s+)?(?:iphone|ipad|android|samsung|blackberry|mobile|windows mail|mail for windows)/i,
  /^\s*get outlook for\b/i,
  /^\s*sent via\b/i,
  /^\s*download outlook for\b/i,
];

const SIGN_OFF =
  /^\s*(?:thanks(?:\s+(?:and\s+)?regards)?|thank you|many thanks|regards|best regards|warm regards|kind regards|best|cheers|br|sincerely|yours truly|rgds)\s*[,.!]?\s*$/i;

/**
 * Signature removal runs AFTER a decision line has already been located, so it
 * can only ever trim the reason -- never the verdict. It also refuses to strip
 * everything: if removal would leave nothing, the original is kept.
 */
export function stripSignature(text: string): string {
  const lines = text.split('\n');
  let cut = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (SIG_HARD.some((re) => re.test(lines[i]))) {
      cut = i;
      break;
    }
  }

  // A trailing sign-off ("Regards,") plus a short name block at the very end.
  if (cut === lines.length) {
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 6; i--) {
      if (SIGN_OFF.test(lines[i])) {
        const after = lines.slice(i + 1).filter((l) => l.trim());
        if (after.length <= 4 && after.every((l) => l.trim().length <= 60)) cut = i;
        break;
      }
    }
  }

  const trimmed = lines.slice(0, cut).join('\n').trim();
  return trimmed.length ? trimmed : text.trim();
}

// ---------------------------------------------------------------------------
// Line filtering
// ---------------------------------------------------------------------------

const SALUTATION = /^\s*(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|team)\b[\s\w.,'-]{0,40}[,:!]?\s*$/i;

/**
 * Drops lines that echo our own outbound instructions.
 *
 * Some clients (and most "reply above this line" flows) leave fragments of the
 * original outside the blockquote. Those fragments contain the literal words
 * "Approved" and "Rejected", so they must be discarded explicitly.
 */
const INSTRUCTION_ECHO = [
  /\breply\b[^.\n]{0,60}\bwith\b[^.\n]{0,60}\b(?:approved?|yes|rejected?|no)\b/i,
  /\bto\s+(?:approve|reject)\b[^.\n]{0,30},/i,
  /\bto\s+approve\b[^.\n]{0,40}\breply\b/i,
  /^\s*ref\s*:\s*trq-/i,
  /\bview\s+in\s+portal\b/i,
  /\bthis\s+is\s+an\s+automated\s+(?:message|email)\b/i,
  /\bdo\s+not\s+(?:reply|respond)\s+to\s+this\b/i,
];

function isNoise(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[\s\p{P}\p{S}]+$/u.test(t)) return true;
  if (SALUTATION.test(t)) return true;
  if (INSTRUCTION_ECHO.some((re) => re.test(t))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Decision rules
// ---------------------------------------------------------------------------

const NEG = String.raw`(?:not|cannot|can\s?not|can['’]?t|won['’]?t|will\s+not|do\s+not|don['’]?t|does\s+not|doesn['’]?t|did\s+not|didn['’]?t|could\s+not|couldn['’]?t|shall\s+not|unable\s+to|refuse\s+to|refusing\s+to)`;
const FILLER = String.raw`(?:\s+(?:be|been|being|going\s+to|able\s+to|hereby|yet|currently|personally|at\s+this\s+time|right\s+now|in\s+a\s+position\s+to))*`;

/** "not approved", "cannot approve", "won't be approving", "unable to authorise". */
const NEGATED_APPROVE = new RegExp(
  String.raw`\b${NEG}${FILLER}\s+(?:approv\w*|authoris\w*|authoriz\w*|sanction\w*|sign\s*[- ]?off)`,
  'gi',
);

/** "no objection", "no issues", "no concerns" -- affirmative despite the "no". */
const NO_OBJECTION = /\bno\s+(?:objections?|issues?|problems?|concerns?|blockers?)\b/gi;

/** "not rejected" is a double negative; it does not mean approved. */
const NEGATED_REJECT = new RegExp(
  String.raw`\b${NEG}${FILLER}\s+(?:reject\w*|declin\w*|den(?:y|ied|ies)|disapprov\w*)`,
  'gi',
);

const RULES: Rule[] = [
  {
    id: 'reject.explicit',
    family: 'reject',
    priority: 95,
    re: /\b(?:reject(?:ed|ing|s)?|declin(?:e|ed|ing|es)|den(?:y|ied|ies)|disapprov(?:e|ed|ing)|refus(?:e|ed|ing)|turn(?:ed|ing)?\s+down|not\s+ok(?:ay)?|no\s+go)\b/i,
  },
  {
    id: 'approve.explicit',
    family: 'approve',
    priority: 90,
    re: /\b(?:approv(?:e|ed|es|ing)|authoris(?:e|ed|es|ing)|authoriz(?:e|ed|es|ing)|sanction(?:ed|s)?|sign(?:ed)?\s*[- ]?off)\b/i,
  },
  {
    id: 'approve.affirmative',
    family: 'approve',
    priority: 80,
    anchored: true,
    re: /^(?:yes|yep|yeah|yup|ok|okay|okey|k|sure|fine|agreed|confirmed|confirm|proceed|please\s+proceed|go\s+ahead|lgtm|looks\s+good(?:\s+to\s+me)?|sounds\s+good|all\s+good|happy\s+to\s+approve)\b/i,
  },
  {
    id: 'reject.negative',
    family: 'reject',
    priority: 80,
    anchored: true,
    re: /^(?:no|nope|nah|negative|denied|declined)\b/i,
  },
];

/** Conditional acceptance is not acceptance. */
const CONDITIONAL =
  /\b(?:but\s+only|only\s+if|provided\s+that|provided\s+you|subject\s+to|conditional(?:ly)?|as\s+long\s+as|on\s+condition|if\s+and\s+only\s+if|once\s+you\s+(?:confirm|change|update)|assuming\s+that)\b/i;

const MASK_APPROVE = 'APPROVEMARK';
const MASK_REJECT = 'REJECTMARK';
const MASK_NEUTRAL = 'NEUTRALMARK';

interface Hit {
  rule: string;
  family: Family;
  priority: number;
  phrase: string;
  lineIndex: number;
  /** Offset of the end of the match within the original line. */
  endOffset: number;
}

/**
 * Masking is what makes precedence work without a conflict-resolution table.
 *
 * "Not approved" contains the substring "approved". Rather than ranking a
 * negation rule above the plain rule and hoping the ordering holds, the negated
 * span is physically replaced before the plain rules ever see the line -- so
 * `approve.explicit` cannot match text that has already been claimed.
 */
function maskLine(line: string): { masked: string; hits: Hit[] } {
  const hits: Hit[] = [];
  let masked = line;

  masked = masked.replace(NEGATED_APPROVE, (m, offset: number) => {
    hits.push({ rule: 'reject.negated_approve', family: 'reject', priority: 100, phrase: m, lineIndex: -1, endOffset: offset + m.length });
    return MASK_REJECT;
  });
  masked = masked.replace(NO_OBJECTION, (m, offset: number) => {
    hits.push({ rule: 'approve.no_objection', family: 'approve', priority: 100, phrase: m, lineIndex: -1, endOffset: offset + m.length });
    return MASK_APPROVE;
  });
  masked = masked.replace(NEGATED_REJECT, () => MASK_NEUTRAL);

  return { masked, hits };
}

// ---------------------------------------------------------------------------
// Reason extraction
// ---------------------------------------------------------------------------

const REASON_LEAD = /^[\s\p{P}]*(?:because|since|as|due to|reason\s*:|-|--)?[\s\p{P}]*/u;

function extractReason(lines: string[], decisionLine: number, endOffset: number): string | null {
  const tail = (lines[decisionLine] ?? '').slice(endOffset);
  const rest = lines.slice(decisionLine + 1);

  const parts: string[] = [];
  const firstPart = tail.replace(REASON_LEAD, '').trim();
  if (firstPart) parts.push(firstPart);
  for (const l of rest) {
    const t = l.trim();
    if (t) parts.push(t);
  }

  const joined = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!joined) return null;
  // Strip a leading conjunction left over from "Approved, but note that ..."
  const cleaned = joined.replace(/^(?:and|but|though|however)\b[\s,]*/i, '').trim();
  return cleaned.length ? cleaned.slice(0, 2000) : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseApprovalReply(input: ParseInput): ParseResult {
  const notes: string[] = [];

  const auto = detectAutoReply(input.headers, input.subject);
  if (auto.why) notes.push(`auto-reply signal: ${auto.why}`);

  // Prefer text/plain. HTML is a fallback because converting it is lossy and
  // every conversion step is a chance to resurrect quoted content.
  let body = '';
  if (input.text && input.text.trim()) {
    body = normalise(input.text);
    notes.push('body source: text/plain');
  } else if (input.html && input.html.trim()) {
    body = normalise(htmlToText(normalise(input.html)));
    notes.push('body source: text/html (converted)');
  } else {
    notes.push('body source: none');
  }

  const { visible: afterQuotes, quoteStartedAt } = stripQuotedText(body);
  if (quoteStartedAt !== null) notes.push(`quoted history removed from line ${quoteStartedAt}`);

  const visibleText = stripSignature(afterQuotes);

  const base: ParseResult = {
    verdict: 'no_decision',
    confidence: 0,
    matchedPhrase: null,
    matchedRule: null,
    reason: null,
    visibleText,
    isAutoReply: auto.isAuto,
    notes,
  };

  // An automated bounce or out-of-office cannot authorise spend, whatever its
  // body happens to say. Checked before rule matching, not after.
  if (auto.isAuto) {
    notes.push('auto-reply: refusing to derive a decision from an automated message');
    return base;
  }

  const rawLines = visibleText.split('\n');
  const candidates = rawLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !isNoise(line));

  if (!candidates.length) {
    notes.push('no meaningful lines after stripping quotes, signature and boilerplate');
    return base;
  }

  const hits: Hit[] = [];
  for (const { line, index } of candidates) {
    const { masked, hits: maskHits } = maskLine(line);
    for (const h of maskHits) hits.push({ ...h, lineIndex: index });

    for (const rule of RULES) {
      const target = masked.trim();
      const m = rule.anchored ? rule.re.exec(target) : rule.re.exec(masked);
      if (!m) continue;
      // Map an anchored match on the trimmed string back to the raw line.
      const offset = rule.anchored ? masked.indexOf(target) + m.index : m.index;
      hits.push({
        rule: rule.id,
        family: rule.family,
        priority: rule.priority,
        phrase: m[0],
        lineIndex: index,
        endOffset: offset + m[0].length,
      });
    }
  }

  if (!hits.length) {
    notes.push('no approve/reject keyword found in visible text');
    return base;
  }

  const families = new Set(hits.map((h) => h.family));
  if (families.size > 1) {
    notes.push(
      `conflicting signals: ${hits.map((h) => `${h.rule}("${h.phrase.trim()}")`).join(', ')}`,
    );
    return { ...base, verdict: 'ambiguous', confidence: 0.4 };
  }

  // Highest priority wins; ties break toward the earliest line, which is where
  // a top-posting manager writes the actual decision.
  hits.sort((a, b) => b.priority - a.priority || a.lineIndex - b.lineIndex);
  const best = hits[0];

  const decisionLine = rawLines[best.lineIndex] ?? '';
  if (CONDITIONAL.test(decisionLine)) {
    notes.push(`conditional language on the decision line: "${decisionLine.trim().slice(0, 120)}"`);
    return { ...base, verdict: 'ambiguous', confidence: 0.4 };
  }

  const firstMeaningfulIndex = candidates[0].index;
  const confidence = best.lineIndex === firstMeaningfulIndex ? 0.99 : 0.85;

  notes.push(`matched ${best.rule} on line ${best.lineIndex} via "${best.phrase.trim()}"`);

  return {
    ...base,
    verdict: best.family,
    confidence,
    matchedPhrase: best.phrase.trim(),
    matchedRule: best.rule,
    reason: extractReason(rawLines, best.lineIndex, best.endOffset),
  };
}
