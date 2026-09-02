import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExternalLink, Pencil } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { StatusBadge } from '@/components/status-badge';
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  buttonVariants,
} from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/supabase/server';
import { formatDateOnly, formatDateTime, formatMoney, relativeDays } from '@/lib/utils';
import { getRequestDetail } from '@/features/requests/queries';
import { AuditTimeline } from '@/features/requests/audit-timeline';
import { RequestActions } from '@/features/requests/request-actions';
import { AttachmentsPanel } from '@/features/requests/attachments-panel';
import { CATEGORY_LABEL, MODE_LABEL } from '@/features/requests/schema';

export const metadata = { title: 'Request · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function RequestDetailPage({ params }: PageProps<'/requests/[id]'>) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/requests/${id}`);

  // RLS decides visibility; a request this user may not see returns null and is
  // reported as missing rather than as forbidden — "forbidden" would confirm it
  // exists to someone who has no business knowing that.
  const detail = await getRequestDetail(id);
  if (!detail) notFound();

  const { request, expenses, links, attachments, audit } = detail;

  const isRequester = request.requester_id === user.id;
  const isApprover = request.manager_email?.toLowerCase() === user.email.toLowerCase();
  const isPending = request.status === 'PENDING_APPROVAL';

  return (
    <AppShell user={user}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">
              {request.from_city ?? '—'}
              <span className="mx-2 font-normal text-muted-foreground" aria-label="to">
                →
              </span>
              {request.to_city ?? '—'}
            </h1>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.requesterName} · {formatDateOnly(request.departure_date)}
            {request.return_date && ` – ${formatDateOnly(request.return_date)}`}
            {request.mode && ` · ${MODE_LABEL[request.mode]}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* The total is the number a manager decides on, so it gets the size. */}
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatMoney(Number(request.total_amount ?? 0), request.currency)}
            </p>
          </div>
          {isRequester && request.status === 'DRAFT' && (
            <Link href={`/requests/${id}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Link>
          )}
        </div>
      </div>

      {request.status === 'REJECTED' && request.decision_reason && (
        <Alert variant="error" className="mb-5">
          <span className="font-medium">Rejected:</span> {request.decision_reason}
        </Alert>
      )}
      {isPending && request.expires_at && (
        <Alert variant="warning" className="mb-5">
          Waiting on {request.manager_email}. This request expires{' '}
          {relativeDays(request.expires_at)} if no decision arrives.
        </Alert>
      )}
      {request.status === 'EXPIRED' && (
        <Alert className="mb-5">
          No decision arrived in time. Duplicate this into a fresh request to try again — the
          original stays on record exactly as it was.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Trip</CardTitle>
            </CardHeader>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Detail label="Route">
                {request.from_city ?? '—'} → {request.to_city ?? '—'}
              </Detail>
              <Detail label="Mode">{request.mode ? MODE_LABEL[request.mode] : '—'}</Detail>
              <Detail label="Departure">{formatDateOnly(request.departure_date)}</Detail>
              <Detail label="Return">
                {request.return_date ? formatDateOnly(request.return_date) : 'One way'}
              </Detail>
              <Detail label="Bill to">{request.bill_to_display ?? '—'}</Detail>
              <Detail label="Approver">{request.manager_email ?? '—'}</Detail>
              <Detail label="Purpose" className="sm:col-span-2">
                <span className="whitespace-pre-wrap">{request.purpose ?? '—'}</span>
              </Detail>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estimated costs</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium">{CATEGORY_LABEL[e.category]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.description ?? ''}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums">
                        {formatMoney(Number(e.amount), e.currency)}
                      </td>
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        No costs entered.
                      </td>
                    </tr>
                  )}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border bg-muted/50">
                      <td className="px-4 py-2.5 font-semibold" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {formatMoney(Number(request.total_amount ?? 0), request.currency)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Booking links</CardTitle>
            </CardHeader>
            <CardBody>
              {links.length ? (
                <ul className="space-y-2">
                  {links.map((l) => (
                    <li key={l.id}>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex max-w-full items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{l.url}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No booking links.</p>
              )}
            </CardBody>
          </Card>

          <AttachmentsPanel
            requestId={id}
            initial={attachments}
            readOnly={!isRequester || request.status !== 'DRAFT'}
          />
        </div>

        <aside className="space-y-5">
          <RequestActions
            requestId={id}
            canDecide={isApprover && isPending}
            canResend={isPending && (isRequester || isApprover || user.role === 'ADMIN')}
            canCancel={isRequester && (request.status === 'DRAFT' || isPending)}
            canDuplicate={
              isRequester && ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(request.status)
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardBody>
              <AuditTimeline rows={audit} />
            </CardBody>
          </Card>

          <p className="px-1 text-xs text-muted-foreground">
            Created {formatDateTime(request.created_at)}
            {request.submitted_at && ` · submitted ${formatDateTime(request.submitted_at)}`}
            {request.decided_at && ` · decided ${formatDateTime(request.decided_at)}`}
          </p>
        </aside>
      </div>
    </AppShell>
  );
}

function Detail({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Plain divs rather than dt/dd: these are laid out in a CSS grid, and a
    // <dl> whose children are re-ordered by grid loses the pairing anyway.
    <div className={className}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{children}</p>
    </div>
  );
}
