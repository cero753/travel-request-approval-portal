import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendApprovalRequestEmail } from '@/features/notifications/send';
import { cronAuthorised } from '../_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PRD 4.6 — one reminder per request, halfway to expiry.
 *
 * `claim_due_reminders` flags the rows and returns them in a single statement
 * (`FOR UPDATE SKIP LOCKED`), so the claim happens *before* any email is sent.
 * If the scheduler double-fires, the second run claims a disjoint set and the
 * manager gets one reminder, not two. The cost of that ordering is that a send
 * failure after a successful claim means no reminder — the right trade, since
 * a duplicate nag is more damaging to trust in the system than a missing one,
 * and the audit row records that it was claimed.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { data: claimed, error } = await createServiceClient().rpc('claim_due_reminders', {
    p_limit: 50,
  });

  if (error) {
    console.error('[cron/reminders] claim failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = claimed ?? [];
  let sent = 0;
  const failed: string[] = [];

  for (const id of ids) {
    const ok = await sendApprovalRequestEmail(id, { isReminder: true });
    if (ok) sent += 1;
    else failed.push(id);
  }

  return NextResponse.json({ ok: true, claimed: ids.length, sent, failed });
}
