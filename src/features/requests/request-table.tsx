import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { formatDateOnly, formatMoney, relativeDays } from '@/lib/utils';
import type { RequestListItem } from './queries';

/**
 * The one table used by every list view.
 *
 * Dense by intent: `h-10`-ish rows, `text-sm`, amounts right-aligned in a
 * tabular font so columns of money line up on the decimal. Finance scans this
 * for minutes at a time; whitespace that looks generous in a screenshot costs
 * them scrolling.
 */
export function RequestTable({
  rows,
  showRequester = false,
  emptyMessage = 'Nothing here yet.',
}: {
  rows: RequestListItem[];
  showRequester?: boolean;
  emptyMessage?: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left">
            <Th>Route</Th>
            <Th>Dates</Th>
            {showRequester && <Th>Requester</Th>}
            <Th>Bill to</Th>
            <Th className="text-right">Total</Th>
            <Th>Status</Th>
            <Th className="w-0" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
              <Td>
                <Link
                  href={`/requests/${r.id}`}
                  className="font-medium hover:underline focus-visible:underline"
                >
                  {r.fromCity ?? '—'}
                  <span className="mx-1.5 text-muted-foreground" aria-label="to">
                    →
                  </span>
                  {r.toCity ?? '—'}
                </Link>
              </Td>
              <Td className="whitespace-nowrap text-muted-foreground">
                {formatDateOnly(r.departureDate)}
                {r.returnDate && ` – ${formatDateOnly(r.returnDate)}`}
              </Td>
              {showRequester && (
                <Td className="whitespace-nowrap">
                  <span className="block leading-tight">{r.requesterName}</span>
                  <span className="block text-xs leading-tight text-muted-foreground">
                    {r.requesterEmail}
                  </span>
                </Td>
              )}
              <Td className="whitespace-nowrap text-muted-foreground">
                {r.billToDisplay ?? '—'}
              </Td>
              <Td className="whitespace-nowrap text-right font-mono tabular-nums">
                {formatMoney(r.totalAmount, r.currency)}
              </Td>
              <Td>
                <StatusBadge status={r.status} />
                {r.status === 'PENDING_APPROVAL' && r.expiresAt && (
                  <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
                    expires {relativeDays(r.expiresAt)}
                  </span>
                )}
              </Td>
              <Td className="pr-3 text-right">
                <Link
                  href={`/requests/${r.id}`}
                  className="inline-flex text-muted-foreground hover:text-foreground"
                  aria-label={`Open request ${r.fromCity} to ${r.toCity}`}
                >
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}
