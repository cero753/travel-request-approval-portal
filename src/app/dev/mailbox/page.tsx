import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui/primitives';
import { devToolsEnabled } from '@/lib/env';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { MailboxClient, type SentMail, type PendingRequest } from '@/features/dev/mailbox-client';

export const metadata = { title: 'Dev mailbox · Travel Approvals' };
export const dynamic = 'force-dynamic';

/**
 * The local stand-in for a mail client (plan step 18).
 *
 * Two gates, not one: proxy.ts 404s `/dev/*` unless dev tools are on, and this
 * page checks again. A matcher is a single regex away from being wrong, and
 * what sits behind it can forge an approval.
 */
export default async function DevMailboxPage() {
  if (!devToolsEnabled()) notFound();

  const user = await getSessionUser();
  if (!user) redirect('/login?next=/dev/mailbox');

  const supabase = createServiceClient();

  const [{ data: mail }, { data: requests }] = await Promise.all([
    supabase
      .from('dev_sent_emails')
      .select(
        'id, to_email, from_email, reply_to, subject, html, text_body, kind, request_id, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('travel_requests')
      .select('id, from_city, to_city, manager_email, status, total_amount, currency')
      .eq('status', 'PENDING_APPROVAL')
      .order('submitted_at', { ascending: false })
      .limit(30),
  ]);

  const pending: PendingRequest[] = (requests ?? []).map((r) => ({
    id: r.id,
    label: `${r.from_city ?? '?'} → ${r.to_city ?? '?'} · ${r.currency} ${r.total_amount}`,
    managerEmail: r.manager_email,
    status: r.status,
  }));

  return (
    <AppShell user={user}>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Dev mailbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Replies sent from here are signed with real Svix and POSTed over real HTTP to the real
          webhook. Only the two Resend network calls are substituted.
        </p>
      </div>

      <Alert variant="warning" className="mb-5">
        This page can approve company spend without a manager. It is unreachable unless
        <code className="mx-1 font-mono">ENABLE_DEV_TOOLS=true</code> and the build is
        non-production.
      </Alert>

      <MailboxClient mail={(mail ?? []) as SentMail[]} requests={pending} />
    </AppShell>
  );
}
