import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Download } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button, Card, CardBody, Input, Label, Select, buttonVariants } from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/supabase/server';
import { listAllRequests, type FinanceFilters } from '@/features/requests/queries';
import { RequestTable } from '@/features/requests/request-table';
import { STATUS_LABEL } from '@/components/status-badge';
import { formatMoney } from '@/lib/utils';

export const metadata = { title: 'Finance · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function FinancePage({ searchParams }: PageProps<'/finance'>) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/finance');

  // proxy.ts already gates this path; repeated here because a matcher is a
  // convenience and this is the actual rule.
  if (user.role !== 'FINANCE' && user.role !== 'ADMIN') redirect('/requests');

  const params = await searchParams;
  const filters: FinanceFilters = {
    status: one(params.status),
    billTo: one(params.billTo),
    from: one(params.from),
    to: one(params.to),
    q: one(params.q),
  };

  const rows = await listAllRequests(filters);

  const approved = rows.filter((r) => r.status === 'APPROVED');
  const pending = rows.filter((r) => r.status === 'PENDING_APPROVAL');
  const sum = (list: typeof rows) => list.reduce((total, r) => total + r.totalAmount, 0);

  const exportHref = `/api/finance/export?${new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  )}`;

  return (
    <AppShell user={user}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every submitted request. Read-only — deciding is the approver&rsquo;s job.
          </p>
        </div>
        <Link href={exportHref} className={buttonVariants({ variant: 'outline' })} prefetch={false}>
          <Download className="size-4" aria-hidden />
          Export CSV
        </Link>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Approved" value={formatMoney(sum(approved))} sub={`${approved.length} requests`} />
        <Stat label="Awaiting approval" value={formatMoney(sum(pending))} sub={`${pending.length} requests`} />
        <Stat label="In view" value={String(rows.length)} sub="matching the filters" />
      </div>

      {/* A GET form: the filter state lives in the URL, so Finance can bookmark
          a view and send it to someone else and get the same numbers. */}
      <Card className="mb-5">
        <CardBody>
          <form method="get" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="q">Search</Label>
              <Input id="q" name="q" defaultValue={filters.q ?? ''} placeholder="City, person, project" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={filters.status ?? ''}>
                <option value="">Any</option>
                {Object.entries(STATUS_LABEL)
                  .filter(([key]) => key !== 'DRAFT')
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billTo">Bill to</Label>
              <Select id="billTo" name="billTo" defaultValue={filters.billTo ?? ''}>
                <option value="">Any</option>
                <option value="AWIGN">Awign</option>
                <option value="PROJECT">Project</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Departing from</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Departing to</Label>
              <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
            </div>
            <div className="flex gap-2 lg:col-span-6">
              <Button type="submit" size="sm">
                Apply filters
              </Button>
              <Link href="/finance" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Clear
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <RequestTable rows={rows} showRequester emptyMessage="No requests match those filters." />
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardBody className="py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardBody>
    </Card>
  );
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0] || undefined;
  return value || undefined;
}
