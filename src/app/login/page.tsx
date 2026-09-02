import { Plane } from 'lucide-react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Travel Approvals' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams;
  const redirectTo = typeof next === 'string' ? next : '/requests';

  const showDemoUsers = process.env.NODE_ENV !== 'production';

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Plane className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Travel Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to submit or approve work travel.
          </p>
        </div>

        <LoginForm redirectTo={redirectTo} />

        {showDemoUsers && (
          <div className="mt-8 rounded-lg border border-border bg-muted/50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Demo accounts · password{' '}
              <code className="font-mono text-foreground">Awign@Demo123</code>
            </p>
            <ul className="space-y-1 font-mono text-xs text-muted-foreground">
              <li>kartik.bhardwaj@awign.example — requester</li>
              <li>priya.sharma@awign.example — manager</li>
              <li>finance@awign.example — finance</li>
              <li>admin@awign.example — admin</li>
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
