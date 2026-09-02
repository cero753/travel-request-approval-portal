import 'server-only';

import { type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { secretsMatch } from '@/lib/tokens';

/**
 * Bearer-secret auth for the scheduled routes.
 *
 * A plain bearer secret rather than anything Vercel- or Supabase-specific: the
 * same `curl` works from a local cron tonight and from AWS EventBridge later,
 * which is what was actually asked for. Comparison is constant-time — see
 * `secretsMatch`.
 *
 * These routes are excluded from proxy.ts's matcher on purpose. They have no
 * session, and gating them on one would mean they could never run unattended.
 */
export function cronAuthorised(req: NextRequest): boolean {
  const header = req.headers.get('authorization');
  const provided = header?.startsWith('Bearer ') ? header.slice(7) : req.headers.get('x-cron-secret');
  return secretsMatch(provided, serverEnv().CRON_SECRET);
}
