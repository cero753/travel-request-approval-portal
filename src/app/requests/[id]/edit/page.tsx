import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/supabase/server';
import {
  getRequestDetail,
  listActiveProjects,
  toFormDefaults,
} from '@/features/requests/queries';
import { RequestForm } from '@/features/requests/request-form';
import { AttachmentsPanel } from '@/features/requests/attachments-panel';

export const metadata = { title: 'Edit request · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function EditRequestPage({ params }: PageProps<'/requests/[id]/edit'>) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/requests/${id}/edit`);

  const detail = await getRequestDetail(id);
  if (!detail) notFound();

  if (detail.request.requester_id !== user.id) {
    return (
      <AppShell user={user}>
        <Alert variant="error">This request belongs to someone else.</Alert>
      </AppShell>
    );
  }

  // A submitted request is frozen. Sending the editor anyway and failing on
  // save would waste their typing; the detail page is where the real options are.
  if (detail.request.status !== 'DRAFT') redirect(`/requests/${id}`);

  const projects = await listActiveProjects();

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Edit draft</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing has been emailed yet. Submitting is what notifies your manager.
        </p>
      </div>

      <RequestForm
        requestId={id}
        defaults={toFormDefaults(detail)}
        projects={projects}
        attachmentSlot={
          <AttachmentsPanel requestId={id} initial={detail.attachments} />
        }
      />
    </AppShell>
  );
}
