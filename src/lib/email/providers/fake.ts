import 'server-only';

import { randomUUID } from 'node:crypto';
import { Webhook } from 'svix';
import { serverEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import {
  PermanentEmailError,
  TransientEmailError,
  type EmailProvider,
  type ReceivedEmail,
  type SendEmailInput,
  type SendEmailResult,
  type WebhookVerification,
} from '../provider';

/**
 * Local stand-in for Resend. Note what it does NOT do: it never short-circuits
 * the pipeline. Outbound mail is stored in `dev_sent_emails` and rendered by
 * /dev/mailbox; inbound replies are staged in the same table the real webhook
 * reads from, and `getReceivedEmail` performs the same second fetch. Signature
 * verification is genuine Svix against the same secret.
 *
 * The consequence worth stating: the code path exercised tonight is the code
 * path that runs in production. Only the two network calls are substituted.
 */
export function createFakeProvider(): EmailProvider {
  const env = serverEnv();

  return {
    name: 'fake',

    async send(input: SendEmailInput): Promise<SendEmailResult> {
      const id = randomUUID();
      const messageIdHeader =
        (input.headers?.['Message-ID'] as string | undefined) ??
        `<${id}@${env.EMAIL_FROM.split('@').pop()?.replace('>', '') ?? 'localhost'}>`;

      const supabase = createServiceClient();
      const { error } = await supabase.from('dev_sent_emails').insert({
        id,
        from_email: env.EMAIL_FROM,
        to_email: input.to,
        reply_to: input.replyTo ?? null,
        subject: input.subject,
        html: input.html,
        text_body: input.text,
        headers_json: { ...input.headers, 'Message-ID': messageIdHeader },
        request_id: input.requestId ?? null,
        kind: input.kind ?? null,
      });
      if (error) throw new PermanentEmailError(`fake send failed: ${error.message}`);

      return { providerMessageId: id, messageIdHeader };
    },

    /**
     * Step two, against `dev_inbound_bodies` — a table the webhook route never
     * reads. The simulator parks the body there and omits it from the payload,
     * so this fetch is as load-bearing locally as it is against Resend.
     */
    async getReceivedEmail(providerEmailId: string): Promise<ReceivedEmail> {
      const supabase = createServiceClient();

      // Honour a forced-failure count so the retry queue can be tested. The
      // claim is atomic, so two concurrent retries cannot both see "fail".
      const { data: claim } = await supabase.rpc('dev_claim_inbound_fetch', {
        p_provider_email_id: providerEmailId,
      });
      if (claim?.[0]?.should_fail) {
        throw new TransientEmailError(
          `simulated step-two failure (attempt ${claim[0].attempt}) for ${providerEmailId}`,
        );
      }

      const { data, error } = await supabase
        .from('dev_inbound_bodies')
        .select('from_email, to_emails, cc_emails, subject, raw_text, raw_html, headers_json')
        .eq('provider_email_id', providerEmailId)
        .maybeSingle();

      if (error) throw new PermanentEmailError(`fake receive failed: ${error.message}`);
      if (!data) throw new PermanentEmailError(`no simulated email with id ${providerEmailId}`);

      return {
        id: providerEmailId,
        from: data.from_email ?? '',
        to: data.to_emails ?? [],
        cc: data.cc_emails ?? [],
        subject: data.subject,
        text: data.raw_text,
        html: data.raw_html,
        headers: (data.headers_json as Record<string, string> | null) ?? {},
      };
    },

    async verifyWebhook(rawBody, headers): Promise<WebhookVerification> {
      try {
        new Webhook(env.EMAIL_WEBHOOK_SECRET).verify(rawBody, headers);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : 'signature verification failed',
        };
      }
    },
  };
}
