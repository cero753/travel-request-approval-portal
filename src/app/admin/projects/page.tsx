import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { getSessionUser, createClient } from '@/lib/supabase/server';
import { ProjectAdmin } from '@/features/admin/project-admin';

export const metadata = { title: 'Projects · Travel Approvals' };
export const dynamic = 'force-dynamic';

export default async function ProjectsAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/admin/projects');
  if (user.role !== 'ADMIN') redirect('/requests');

  const supabase = await createClient();
  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name, active')
    .order('code');

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codes offered when someone bills a trip to a project. Deactivating a code hides it from
          new requests without touching the ones already billed to it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project codes</CardTitle>
        </CardHeader>
        <CardBody>
          <ProjectAdmin initial={projects ?? []} />
        </CardBody>
      </Card>
    </AppShell>
  );
}
