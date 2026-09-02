import { NextResponse } from 'next/server';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Liveness + config check. Reports which optional secrets are *present*, never
 * their values — the integration suite uses this to fail fast with a useful
 * message instead of timing out on a half-configured machine.
 */
export async function GET() {
  let publicOk = true;
  try {
    publicEnv();
  } catch {
    publicOk = false;
  }

  return NextResponse.json({
    ok: publicOk,
    publicEnv: publicOk,
    serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    emailProvider: process.env.EMAIL_PROVIDER ?? 'fake',
    webhookSecret: Boolean(process.env.EMAIL_WEBHOOK_SECRET),
    devTools: process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_TOOLS === 'true',
  });
}
