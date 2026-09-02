import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/supabase/server';
import { listAllRequests, type FinanceFilters } from '@/features/requests/queries';
import { toCsv } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CSV export (PRD 4.8).
 *
 * RBAC is enforced here rather than trusted from the page that linked to it —
 * this URL is guessable, and "the button was hidden" has never been an access
 * control. A requester who types it gets 403.
 *
 * Cells are escaped by `toCsv`, which also blocks formula injection.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.role !== 'FINANCE' && user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Finance access only' }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const filters: FinanceFilters = {
    status: p.get('status') ?? undefined,
    billTo: p.get('billTo') ?? undefined,
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
    q: p.get('q') ?? undefined,
  };

  const rows = await listAllRequests(filters);

  const csv = toCsv(
    [
      'Request ID',
      'Status',
      'Requester',
      'Requester email',
      'Approver email',
      'From',
      'To',
      'Departure',
      'Return',
      'Bill to',
      'Currency',
      'Total',
      'Submitted at',
    ],
    rows.map((r) => [
      r.id,
      r.status,
      r.requesterName,
      r.requesterEmail,
      r.managerEmail ?? '',
      r.fromCity ?? '',
      r.toCity ?? '',
      r.departureDate ?? '',
      r.returnDate ?? '',
      r.billToDisplay ?? '',
      r.currency,
      // Raw number, not formatted: a currency symbol and thousands separators
      // would arrive in the spreadsheet as text and refuse to sum.
      r.totalAmount.toFixed(2),
      r.submittedAt ?? '',
    ]),
  );

  // BOM so Excel reads it as UTF-8; without it, names with accents are mangled.
  const body = `﻿${csv}`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="travel-requests.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
