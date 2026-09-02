import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { getSessionUser } from '@/lib/supabase/server';
import { listAwaitingMe, listDecidedByMe } from '@/features/requests/queries';
import { RequestTable } from '@/features/requests/request-table';
import { formatMoney } from '@/lib/utils';

export const metadata = { title: 'Approvals · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/approvals');

  const [awaiting, decided] = await Promise.all([
    listAwaitingMe(user.email),
    listDecidedByMe(user.email),
  ]);

  const pendingTotal = awaiting.reduce((sum, r) => sum + r.totalAmount, 0);

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {awaiting.length === 0
            ? 'Nothing is waiting on you.'
            : `${awaiting.length} request${awaiting.length === 1 ? '' : 's'} waiting on you · ${formatMoney(pendingTotal)} in total`}
        </p>
      </div>

      <div className="space-y-8">
        <section>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Waiting on you</h2>
            {/* Oldest first: the request that has been waiting longest is the
                one most at risk of expiring unanswered. */}
            <span className="text-xs text-muted-foreground">longest wait first</span>
          </div>
          <RequestTable
            rows={awaiting}
            showRequester
            emptyMessage="Nothing to approve right now."
          />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-tight">Already decided</h2>
          <RequestTable
            rows={decided}
            showRequester
            emptyMessage="Requests you have decided will appear here."
          />
        </section>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        You can also decide by simply replying <span className="font-medium">Approved</span> or{' '}
        <span className="font-medium">Rejected</span> to the email — no need to come here.
      </p>
    </AppShell>
  );
}
