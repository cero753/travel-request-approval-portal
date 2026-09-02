import { z } from 'zod';

/**
 * Environment access. Two rules make this file worth existing:
 *
 * 1. `process.env.X` is never read anywhere else. A typo in a secret name would
 *    otherwise fail silently as `undefined` at 3am inside a webhook.
 * 2. Server secrets are validated *lazily*, on first access, not at import time.
 *    Eager validation would make the whole app refuse to boot on a machine that
 *    only wants to run `next build` or the unit tests.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only for *literal*
 * member expressions, so the public block below must stay written out longhand.
 */

const url = z.string().url();
const nonEmpty = z.string().min(1);

// --- public: safe to ship to the browser ------------------------------------

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  NEXT_PUBLIC_APP_URL: url.default('http://localhost:3000'),
});

// Longhand on purpose — see note above.
const rawPublic = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

let publicCache: z.infer<typeof publicSchema> | null = null;

export function publicEnv(): z.infer<typeof publicSchema> {
  if (publicCache) return publicCache;
  const parsed = publicSchema.safeParse(rawPublic);
  if (!parsed.success) throw new Error(formatIssues('public env', parsed.error));
  publicCache = parsed.data;
  return publicCache;
}

// --- server: must never reach the browser -----------------------------------

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,

  /** Mixed into the token hash so a leaked DB dump alone can't mint approvals. */
  TOKEN_PEPPER: z.string().min(32, 'TOKEN_PEPPER must be at least 32 characters'),
  /** Compared timing-safely by the cron routes. */
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),

  EMAIL_PROVIDER: z.enum(['fake', 'resend']).default('fake'),
  EMAIL_FROM: nonEmpty.default('Awign Travel <approvals@awign.example>'),
  /** Base of the reply address; the request key is appended as a plus-tag. */
  EMAIL_REPLY_TO_BASE: nonEmpty.default('approvals@awign.example'),

  /**
   * Resend can only send to the account owner until a domain is verified. Set
   * this to your own inbox for tomorrow's live smoke test and every outbound
   * mail is rerouted there, with the true recipient kept in a header.
   */
  EMAIL_REDIRECT_TO: z.string().email().optional(),

  RESEND_API_KEY: z.string().optional(),

  /**
   * Svix signing secret for the inbound webhook. Deliberately NOT named after
   * Resend: the fake provider signs its simulated deliveries with this same
   * secret, so the local flow exercises real signature verification. Tomorrow
   * this value is replaced with the one Resend prints, and nothing else moves.
   */
  EMAIL_WEBHOOK_SECRET: z.string().regex(/^whsec_/, 'EMAIL_WEBHOOK_SECRET must start with whsec_'),

  /** Gates /dev/mailbox and the inbound simulator. Refused in production. */
  ENABLE_DEV_TOOLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  REQUEST_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  REMINDER_AFTER_DAYS: z.coerce.number().int().positive().default(3),
  MAX_CLARIFICATIONS: z.coerce.number().int().nonnegative().default(2),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let serverCache: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (serverCache) return serverCache;
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() was called in the browser. This is a secret leak — fix the import.');
  }
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(formatIssues('server env', parsed.error));

  const env = parsed.data;

  // Cross-field rules the object schema can't express on its own.
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY.');
  }
  if (process.env.NODE_ENV === 'production' && env.ENABLE_DEV_TOOLS) {
    throw new Error('ENABLE_DEV_TOOLS=true in production. The dev mailbox can forge approvals.');
  }
  if (env.REMINDER_AFTER_DAYS >= env.REQUEST_EXPIRY_DAYS) {
    throw new Error('REMINDER_AFTER_DAYS must be less than REQUEST_EXPIRY_DAYS.');
  }

  serverCache = env;
  return serverCache;
}

/** True when the dev mailbox and inbound simulator are permitted to run. */
export function devToolsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_TOOLS === 'true';
}

function formatIssues(label: string, error: z.ZodError): string {
  const lines = error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  return `Invalid ${label}:\n${lines.join('\n')}\n\nCopy .env.example to .env.local and fill it in.`;
}

/** Test-only. Env is cached; a test that mutates process.env must clear it. */
export function __resetEnvCacheForTests(): void {
  publicCache = null;
  serverCache = null;
}
