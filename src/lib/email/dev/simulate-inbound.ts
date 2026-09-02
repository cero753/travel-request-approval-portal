import 'server-only';

import { randomUUID } from 'node:crypto';
import { Webhook } from 'svix';
import { devToolsEnabled, publicEnv, serverEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { buildRefToken, buildReplyAddress } from '../address';

/**
 * Simulates a manager replying to an approval email.
 *
 * This is not a shortcut past the pipeline — it is a mail server standing in
 * for Resend. It:
 *   1. builds a realistic reply, quoted original included;
 *   2. parks the body in `dev_inbound_bodies`, which the webhook cannot read;
 *   3. emits a metadata-only `email.received` payload, forcing the real
 *      two-step fetch;
 *   4. signs it with real Svix using EMAIL_WEBHOOK_SECRET;
 *   5. POSTs it over real HTTP to the real webhook route.
 *
 * Everything downstream — signature check, dedupe, step two, the parser,
 * `decide_request` — is production code.
 */

export interface SimulateOptions {
  requestId: string;
  /** What the manager typed, above the quote. */
  body: string;
  /** Overrides the sender. Use to test the wrong-sender rejection path. */
  fromOverride?: string;
  /** Send HTML only, no text/plain — the awkward case for the parser. */
  htmlOnly?: boolean;
  /** Put the reply *below* the quoted original. */
  bottomPost?: boolean;
  /** Stamp Auto-Submitted: auto-replied, as an out-of-office would. */
  asAutoReply?: boolean;
  /** Deliver the same svix-id twice, as Svix does on a timeout. */
  deliverTwice?: boolean;
  /** Force step two to fail this many times before succeeding. */
  failFetches?: number;
  /** Drop the plus tag from the To address, forcing a lower-priority matcher. */
  omitPlusAddress?: boolean;
  /** Omit the quoted original, removing the TRQ- ref token as well. */
  omitQuote?: boolean;
}

export interface SimulateResult {
  svixId: string;
  providerEmailId: string;
  status: number;
  responseBody: string;
  secondStatus?: number;
}

export async function simulateInboundReply(opts: SimulateOptions): Promise<SimulateResult> {
  if (!devToolsEnabled()) {
    throw new Error('simulateInboundReply requires ENABLE_DEV_TOOLS=true and a non-production build');
  }

  const env = serverEnv();
  const supabase = createServiceClient();

  const { data: request, error } = await supabase
    .from('travel_requests')
    .select(
      'id, reply_key, manager_email, from_city, to_city, departure_date, total_amount, currency, requester_id, profiles!travel_requests_requester_id_fkey(full_name)',
    )
    .eq('id', opts.requestId)
    .single();

  if (error || !request) throw new Error(`No such request ${opts.requestId}: ${error?.message}`);

  const requesterName =
    (request.profiles as unknown as { full_name: string } | null)?.full_name ?? 'the requester';

  const from = opts.fromOverride ?? request.manager_email ?? 'unknown@example.com';
  const replyAddress = buildReplyAddress(env.EMAIL_REPLY_TO_BASE, request.reply_key);
  const to = opts.omitPlusAddress ? env.EMAIL_REPLY_TO_BASE : replyAddress;

  const subject = `Re: Travel approval needed: ${requesterName} — ${request.from_city} to ${request.to_city}`;

  // The original message id, so In-Reply-To threading (matcher strategy 3) has
  // something real to match against.
  const { data: sent } = await supabase
    .from('dev_sent_emails')
    .select('message_id_header')
    .eq('request_id', request.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const inReplyTo = sent?.message_id_header ?? null;

  const quoted = opts.omitQuote
    ? ''
    : [
        '',
        `On ${new Date().toDateString()}, Awign Travel <${env.EMAIL_REPLY_TO_BASE}> wrote:`,
        '',
        `> Travel approval needed: ${requesterName} — ${request.from_city} to ${request.to_city}`,
        '>',
        '> To approve, simply reply to this email with Approved or Yes.',
        '> To reject, reply with Rejected or No (you may add a reason).',
        '>',
        `> Total estimated cost: ${request.currency} ${request.total_amount}`,
        `> Ref: ${buildRefToken(request.reply_key)}`,
      ].join('\n');

  const plain = opts.bottomPost ? `${quoted}\n\n${opts.body}` : `${opts.body}${quoted}`;

  const html = opts.omitQuote
    ? `<div dir="ltr"><p>${escapeHtml(opts.body)}</p></div>`
    : `<div dir="ltr"><p>${escapeHtml(opts.body)}</p></div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">` +
      `<p>Travel approval needed: ${escapeHtml(requesterName)}</p>` +
      `<p>To approve, simply reply to this email with Approved or Yes.<br>To reject, reply with Rejected or No.</p>` +
      `<p>Ref: ${buildRefToken(request.reply_key)}</p></blockquote>`;

  const providerEmailId = randomUUID();

  const headers: Record<string, string> = {
    'message-id': `<${providerEmailId}@mail.example>`,
    from,
    to,
    subject,
    // No real DNS is involved locally, so these are stated rather than earned.
    // processInbound only trusts them because devToolsEnabled() is true.
    'authentication-results': 'mx.example; spf=pass; dkim=pass; dmarc=pass',
    ...(inReplyTo ? { 'in-reply-to': inReplyTo, references: inReplyTo } : {}),
    ...(opts.asAutoReply ? { 'auto-submitted': 'auto-replied' } : {}),
  };

  // Park the body where the webhook cannot see it. Step two must go and get it.
  const { error: bodyError } = await supabase.from('dev_inbound_bodies').insert({
    provider_email_id: providerEmailId,
    from_email: from,
    to_emails: [to],
    cc_emails: [],
    subject,
    raw_text: opts.htmlOnly ? null : plain,
    raw_html: html,
    headers_json: headers,
    fail_fetches_remaining: opts.failFetches ?? 0,
  });
  if (bodyError) throw new Error(`Could not stage simulated body: ${bodyError.message}`);

  // Metadata only — this is the shape Resend's email.received actually sends.
  const payload = {
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: providerEmailId,
      from,
      to: [to],
      cc: [],
      received_for: to,
      message_id: headers['message-id'],
      subject,
      attachments: [],
    },
  };

  const svixId = `msg_${randomUUID().replace(/-/g, '')}`;
  const raw = JSON.stringify(payload);

  // A genuine signature over the exact bytes we are about to send. If the route
  // ever re-serialises the body before verifying, this will start failing —
  // which is the point.
  const signature = new Webhook(env.EMAIL_WEBHOOK_SECRET).sign(svixId, new Date(), raw);

  const url = `${publicEnv().NEXT_PUBLIC_APP_URL}/api/webhooks/email/inbound`;
  const post = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': signature,
      },
      body: raw,
    });

  const res = await post();
  const responseBody = await res.text();

  let secondStatus: number | undefined;
  if (opts.deliverTwice) {
    const again = await post();
    secondStatus = again.status;
  }

  return { svixId, providerEmailId, status: res.status, responseBody, secondStatus };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
