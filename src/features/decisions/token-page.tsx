import 'server-only';

import { Plane } from 'lucide-react';
import { Alert } from '@/components/ui/primitives';
import { peekToken } from '@/lib/tokens';
import { createServiceClient } from '@/lib/supabase/service';
import { formatDateOnly, formatMoney } from '@/lib/utils';
import { ConfirmPanel } from './confirm-panel';

/**
 * Shared body of `/approve` and `/reject`.
 *
 * This runs on GET and reads only. Every branch below that refuses is worded so
 * a manager can tell *why* without needing an account to look at — "already
 * decided" and "link expired" are different situations and get different text.
 */
export async function TokenDecisionPage({
  token,
  expected,
}: {
  token: string | undefined;
  expected: 'APPROVE' | 'REJECT';
}) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Plane className="size-4" aria-hidden />
        </span>
        <span className="font-semibold">Travel Approvals</span>
      </div>

      {await body(token, expected)}
    </main>
  );
}

async function body(token: string | undefined, expected: 'APPROVE' | 'REJECT') {
  if (!token) {
    return <Alert variant="error">That link is missing its token. Open it from the email again.</Alert>;
  }

  const peeked = await peekToken(token);
  if (!peeked) {
    return (
      <Alert variant="error">
        That link is not valid. If you copied it by hand, some characters may have been dropped —
        click it directly from the email instead.
      </Alert>
    );
  }

  // A reject token on /approve (or the reverse) means the URL was edited. Refuse
  // rather than quietly honouring whichever the token says.
  if (peeked.action !== expected) {
    return <Alert variant="error">That link does not match this page.</Alert>;
  }

  if (peeked.used) {
    return (
      <Alert variant="warning">
        This link has already been used. The decision it carried is already on the record — there is
        nothing left to do.
      </Alert>
    );
  }

  if (peeked.expired) {
    return (
      <Alert variant="warning">
        This link has expired. The request was closed without a decision; ask the requester to
        submit it again.
      </Alert>
    );
  }

  // Service client: there is no session on this page by design.
  const supabase = createServiceClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select(
      'id, status, from_city, to_city, departure_date, return_date, total_amount, currency, bill_to_display, purpose, requester_id',
    )
    .eq('id', peeked.requestId)
    .maybeSingle();

  if (!request) return <Alert variant="error">That request no longer exists.</Alert>;

  if (request.status !== 'PENDING_APPROVAL') {
    return (
      <Alert variant="warning">
        This request is {request.status.toLowerCase().replace('_', ' ')} and is no longer awaiting a
        decision.
      </Alert>
    );
  }

  const { data: requester } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', request.requester_id)
    .maybeSingle();

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">
        {expected === 'APPROVE' ? 'Approve this travel request?' : 'Reject this travel request?'}
      </h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Check the details, then confirm below.
      </p>

      <ConfirmPanel
        token={token}
        action={expected}
        summary={{
          requester: requester?.full_name ?? requester?.email ?? 'Unknown requester',
          route: `${request.from_city ?? '?'} → ${request.to_city ?? '?'}`,
          dates: request.return_date
            ? `${formatDateOnly(request.departure_date)} – ${formatDateOnly(request.return_date)}`
            : `${formatDateOnly(request.departure_date)} (one way)`,
          total: formatMoney(Number(request.total_amount ?? 0), request.currency),
          billTo: request.bill_to_display ?? '—',
          purpose: request.purpose ?? '—',
        }}
      />
    </>
  );
}
