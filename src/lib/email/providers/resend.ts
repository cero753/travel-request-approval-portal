import 'server-only';

import { Webhook } from 'svix';
import { serverEnv } from '@/lib/env';
import {
  PermanentEmailError,
  TransientEmailError,
  type EmailProvider,
  type ReceivedEmail,
  type SendEmailInput,
  type SendEmailResult,
  type WebhookVerification,
} from '../provider';

const API = 'https://api.resend.com';

export function createResendProvider(): EmailProvider {
  const env = serverEnv();

  return {
    name: 'resend',

    async send(input: SendEmailInput): Promise<SendEmailResult> {
      // Until a sending domain is verified, Resend only delivers to the account
      // owner. EMAIL_REDIRECT_TO reroutes everything there while preserving the
      // intended recipient, so the first live smoke test is still meaningful.
      const redirected = env.EMAIL_REDIRECT_TO;
      const to = redirected ?? input.to;
      const headers = {
        ...input.headers,
        ...(redirected ? { 'X-Original-To': input.to } : {}),
      };

      const res = await fetch(`${API}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to,
          subject: redirected ? `[to: ${input.to}] ${input.subject}` : input.subject,
          html: input.html,
          text: input.text,
          reply_to: input.replyTo,
          headers,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        // 429 and 5xx are worth retrying; a 422 on a malformed address is not.
        const Err = res.status === 429 || res.status >= 500 ? TransientEmailError : PermanentEmailError;
        throw new Err(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as { id: string };
      return {
        providerMessageId: json.id,
        // Resend does not return the Message-ID it stamped. It derives from the
        // send id, but that mapping is undocumented, so matcher strategy 3
        // relies on the header we set ourselves at call time instead.
        messageIdHeader: (input.headers?.['Message-ID'] as string | undefined) ?? null,
      };
    },

    /**
     * Step two of inbound. The `email.received` webhook is metadata-only — no
     * body, no headers — so this call is mandatory, not an optimisation.
     * Written with raw `fetch` because the `resend` SDK had not exposed the
     * receiving endpoint at the time of writing.
     */
    async getReceivedEmail(providerEmailId: string): Promise<ReceivedEmail> {
      const res = await fetch(`${API}/emails/receiving/${encodeURIComponent(providerEmailId)}`, {
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      });

      if (res.status === 404) {
        // Can mean "not yet materialised" or "never existed". The retry queue
        // gives it a bounded number of chances and then gives up, so treating
        // it as transient here is safe.
        throw new TransientEmailError(`Received email ${providerEmailId} not found yet (404)`);
      }
      if (!res.ok) {
        const body = await res.text();
        const Err = res.status >= 500 || res.status === 429 ? TransientEmailError : PermanentEmailError;
        throw new Err(`Resend receive fetch failed (${res.status}): ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as Record<string, unknown>;
      return {
        id: providerEmailId,
        from: String(json.from ?? ''),
        to: toArray(json.to),
        cc: toArray(json.cc),
        subject: (json.subject as string | null) ?? null,
        text: (json.text as string | null) ?? null,
        html: (json.html as string | null) ?? null,
        headers: normaliseHeaders(json.headers),
      };
    },

    async verifyWebhook(rawBody, headers): Promise<WebhookVerification> {
      try {
        new Webhook(env.EMAIL_WEBHOOK_SECRET).verify(rawBody, headers);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'signature verification failed' };
      }
    },
  };
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Resend returns headers either as an object or as an array of {name, value}
 * depending on the endpoint. Normalise to lowercase keys so callers can look
 * up `auto-submitted` without guessing the casing the sender used.
 */
function normaliseHeaders(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const h of value) {
      if (h && typeof h === 'object' && 'name' in h && 'value' in h) {
        out[String((h as { name: unknown }).name).toLowerCase()] = String(
          (h as { value: unknown }).value,
        );
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.toLowerCase()] = String(v);
    }
  }
  return out;
}
