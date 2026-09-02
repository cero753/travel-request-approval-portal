import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { buttonVariants } from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/supabase/server';
import { listMyRequests } from '@/features/requests/queries';
import { RequestTable } from '@/features/requests/request-table';
import { formatMoney } from '@/lib/utils';

export const metadata = { title: 'My requests · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function MyRequestsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/requests');

  const rows = await listMyRequests(user.id);

  const drafts = rows.filter((r) => r.status === 'DRAFT');
  const pending = rows.filter((r) => r.status === 'PENDING_APPROVAL');
  const settled = rows.filter((r) => r.status !== 'DRAFT' && r.status !== 'PENDING_APPROVAL');

  // Only approved money is committed money — a pending total would read as a
  // spend figure Finance never agreed to.
  const approvedTotal = rows
    .filter((r) => r.status === 'APPROVED')
    .reduce((sum, r) => sum + r.totalAmount, 0);

  return (
    <AppShell user={user}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending.length} awaiting approval · {formatMoney(approvedTotal)} approved to date
          </p>
        </div>
        <Link href="/requests/new" className={buttonVariants()}>
          <Plus className="size-4" aria-hidden />
          New request
        </Link>
      </div>

      <div className="space-y-8">
        {drafts.length > 0 && (
          <Section title="Drafts" hint="Not yet sent to anyone.">
            <RequestTable rows={drafts} />
          </Section>
        )}

        <Section title="Awaiting approval">
          <RequestTable
            rows={pending}
            emptyMessage="No requests are waiting on a manager right now."
          />
        </Section>

        <Section title="History">
          <RequestTable rows={settled} emptyMessage="Decided requests will appear here." />
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
