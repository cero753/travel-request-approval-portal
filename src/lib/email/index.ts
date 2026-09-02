import 'server-only';

import { serverEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import type { EmailProvider, SendEmailInput } from './provider';
import { createFakeProvider } from './providers/fake';
import { createResendProvider } from './providers/resend';

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  cached = serverEnv().EMAIL_PROVIDER === 'resend' ? createResendProvider() : createFakeProvider();
  return cached;
}

/** Tests swap in a spy; production never calls this. */
export function __setEmailProviderForTests(provider: EmailProvider | null): void {
  cached = provider;
}

/**
 * Send, and record the attempt either way.
 *
 * A send that fails must still leave a trace: "the manager says they never got
 * it" is the single most common dispute in an approval workflow, and an empty
 * table cannot answer it. So a failure writes SEND_FAILED and returns null
 * rather than throwing — the caller decides whether that is fatal.
 */
export async function sendAndRecord(
  input: SendEmailInput,
): Promise<{ providerMessageId: string; messageIdHeader: string | null } | null> {
  const provider = getEmailProvider();
  const supabase = createServiceClient();

  try {
    const result = await provider.send(input);

    await supabase.from('email_events').insert({
      type: 'SENT',
      kind: input.kind ?? null,
      request_id: input.requestId ?? null,
      to_email: input.to,
      from_email: serverEnv().EMAIL_FROM,
      reply_to: input.replyTo ?? null,
      subject: input.subject,
      provider_message_id: result.providerMessageId,
      message_id_header: result.messageIdHeader,
      payload_json: { provider: provider.name },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from('email_events').insert({
      type: 'SEND_FAILED',
      kind: input.kind ?? null,
      request_id: input.requestId ?? null,
      to_email: input.to,
      subject: input.subject,
      payload_json: { provider: provider.name, error: message },
    });
    console.error('[email] send failed', { to: input.to, kind: input.kind, message });
    return null;
  }
}
