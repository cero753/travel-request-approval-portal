import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendExpiryNoticeEmail } from '@/features/notifications/send';
import { cronAuthorised } from '../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PRD 4.6 — close requests that ran out of time.
 *
 * The transition and the audit row happen inside `expire_due_requests`, which
 * only moves rows still in `PENDING_APPROVAL`. A reply landing in the same
 * second therefore either wins (and the row is no longer pending, so expiry
 * skips it) or loses (and `decide_request` reports `applied=false`). There is
 * no interleaving in which both a decision and an expiry are recorded.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { data: expired, error } = await createServiceClient().rpc('expire_due_requests', {
    p_limit: 100,
  });

  if (error) {
    console.error('[cron/expire] failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = expired ?? [];
  let notified = 0;

  for (const id of ids) {
    // The status change is already committed; a failed notice is logged and
    // does not roll anything back. Letting one bad address stop the loop would
    // leave the rest of the batch un-notified for no reason.
    if (await sendExpiryNoticeEmail(id)) notified += 1;
  }

  return NextResponse.json({ ok: true, expired: ids.length, notified });
}
