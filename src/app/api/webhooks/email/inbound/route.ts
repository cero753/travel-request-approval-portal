import { NextResponse, type NextRequest } from 'next/server';
import type { Json } from '@/lib/supabase/database.types';
import { getEmailProvider } from '@/lib/email';
import { createServiceClient } from '@/lib/supabase/service';
import { normaliseAddress, normaliseAddressList } from '@/lib/email/address';
import { processInboundEmail } from '@/features/inbound/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbound email webhook.
 *
 * Ordering here is not stylistic:
 *
 *  1. `await req.text()` FIRST. The Svix signature covers the exact bytes on
 *     the wire. Calling `req.json()` and re-stringifying changes key order and
 *     whitespace, and the signature stops matching. proxy.ts is also configured
 *     not to match this path for the same reason.
 *  2. Verify before reading anything. An unverified payload is attacker input,
 *     and this endpoint approves company spend.
 *  3. Insert the staging row before doing any work, keyed by svix-id with a
 *     unique index. Svix retries on timeout; the dedupe is what stops one
 *     approval being applied twice.
 *
 * Always returns 2xx once the row is durably staged, even if later processing
 * fails — otherwise Svix retries a message we have already accepted, and the
 * retry queue we built is the thing that should own that recovery.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const provider = getEmailProvider();
  const verification = await provider.verifyWebhook(rawBody, headers);
  if (!verification.ok) {
    console.warn('[inbound] rejected unsigned or invalid webhook:', verification.reason);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const svixId = headers['svix-id'];
  if (!svixId) return NextResponse.json({ error: 'missing svix-id' }, { status: 400 });

  let payload: InboundPayload;
  try {
    payload = JSON.parse(rawBody) as InboundPayload;
  } catch {
    return NextResponse.json({ error: 'malformed json' }, { status: 400 });
  }

  if (payload.type !== 'email.received') {
    // Delivery/bounce events share the endpoint in some configurations.
    await recordNonInboundEvent(payload);
    return NextResponse.json({ ok: true, ignored: `event type ${payload.type}` });
  }

  const data: InboundData = payload.data ?? {};
  const supabase = createServiceClient();

  const { data: staged, error } = await supabase
    .from('inbound_emails')
    .insert({
      svix_id: svixId,
      provider_email_id: data.email_id ?? null,
      from_email: normaliseAddress(data.from),
      to_emails: normaliseAddressList(data.to),
      cc_emails: normaliseAddressList(data.cc),
      received_for: normaliseAddress(data.received_for),
      subject: data.subject ?? null,
      message_id_header: data.message_id ?? null,
      webhook_payload: payload as unknown as Json,
      fetch_status: 'PENDING',
      process_status: 'PENDING',
    })
    .select('id')
    .single();

  if (error) {
    // 23505 is the unique violation on svix_id: this is a redelivery of a
    // message already accepted. Acknowledge it so Svix stops retrying.
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('[inbound] could not stage message', error);
    return NextResponse.json({ error: 'staging failed' }, { status: 500 });
  }

  // Process inline: it is fast, and doing it here means the dev simulator's
  // single HTTP call exercises the whole pipeline. Failures land in the retry
  // queue rather than propagating, so the 200 below stays honest.
  try {
    await processInboundEmail(staged.id);
  } catch (err) {
    console.error('[inbound] processing failed; left for retry', err);
  }

  return NextResponse.json({ ok: true, inboundId: staged.id });
}

/** Svix's browser check and some providers probe with GET. Nothing to say. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'email inbound webhook' });
}

interface InboundData {
  email_id?: string;
  from?: string;
  to?: string[] | string;
  cc?: string[] | string;
  received_for?: string;
  message_id?: string;
  subject?: string;
}

interface InboundPayload {
  type: string;
  created_at?: string;
  data?: InboundData;
}

async function recordNonInboundEvent(payload: InboundPayload) {
  const map: Record<string, string> = {
    'email.delivered': 'DELIVERED',
    'email.bounced': 'BOUNCED',
    'email.complained': 'COMPLAINED',
    'email.delivery_delayed': 'DELIVERY_DELAYED',
  };
  const type = map[payload.type];
  if (!type) return;

  await createServiceClient()
    .from('email_events')
    .insert({
      type: type as never,
      to_email: normaliseAddress(
        Array.isArray(payload.data?.to) ? payload.data?.to[0] : payload.data?.to,
      ),
      subject: payload.data?.subject ?? null,
      provider_message_id: payload.data?.email_id ?? null,
      payload_json: payload as unknown as Json,
    });
}
