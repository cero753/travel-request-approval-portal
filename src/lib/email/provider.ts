import 'server-only';

import type { Enums } from '@/lib/supabase/database.types';

/**
 * The seam between this app and whichever email vendor is behind it.
 *
 * Tonight everything runs against `fake`. Tomorrow `EMAIL_PROVIDER=resend`
 * swaps the implementation and no calling code changes. The interface is shaped
 * around what Resend actually does — in particular `getReceivedEmail`, which
 * exists because Resend's inbound webhook delivers **metadata only** and the
 * body must be fetched in a second call. A provider that pushes the full body
 * can implement that method as a lookup of what it already stored.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where a manager's reply should land. Carries the per-request plus tag. */
  replyTo?: string;
  /** Threads the reply under the original in the manager's client. */
  headers?: Record<string, string>;
  requestId?: string | null;
  kind?: Enums<'email_kind'> | null;
}

export interface SendEmailResult {
  providerMessageId: string;
  /**
   * The RFC 5322 `Message-ID`. Stored so an inbound `In-Reply-To` can be matched
   * back to the request (matcher strategy 3).
   */
  messageIdHeader: string | null;
}

/** Step two of inbound: the actual content, fetched by provider email id. */
export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
}

export interface WebhookVerification {
  ok: boolean;
  reason?: string;
}

export interface EmailProvider {
  readonly name: 'resend' | 'fake';
  send(input: SendEmailInput): Promise<SendEmailResult>;
  getReceivedEmail(providerEmailId: string): Promise<ReceivedEmail>;
  /** Verifies a Svix signature over the **raw** body. Never over a re-serialised object. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookVerification>;
}

/** Thrown when step two fails in a way that is worth retrying (5xx, network). */
export class TransientEmailError extends Error {
  readonly transient = true;
  constructor(message: string) {
    super(message);
    this.name = 'TransientEmailError';
  }
}

/** Thrown when retrying cannot help (404, malformed id). */
export class PermanentEmailError extends Error {
  readonly transient = false;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentEmailError';
  }
}
