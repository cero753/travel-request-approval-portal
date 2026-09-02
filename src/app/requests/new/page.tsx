import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { getSessionUser } from '@/lib/supabase/server';
import { getDefaultManagerEmail, listActiveProjects } from '@/features/requests/queries';
import { RequestForm } from '@/features/requests/request-form';

export const metadata = { title: 'New request · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function NewRequestPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/requests/new');

  const [projects, managerEmail] = await Promise.all([
    listActiveProjects(),
    getDefaultManagerEmail(user.id),
  ]);

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">New travel request</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your manager approves by replying to the email — they do not need an account here.
        </p>
      </div>

      {/* Attachments need a request id to hang off, so the upload panel only
          appears once the draft has been saved (see the edit page). */}
      <RequestForm requestId={null} defaults={{ managerEmail }} projects={projects} />
    </AppShell>
  );
}
