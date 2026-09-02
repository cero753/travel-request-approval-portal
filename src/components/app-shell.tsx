import Link from 'next/link';
import { Plane } from 'lucide-react';
import type { SessionUser } from '@/lib/supabase/server';
import { Button } from '@/components/ui/primitives';
import { NavLink } from './nav-link';
import { devToolsEnabled } from '@/lib/env';

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const nav: Array<{ href: string; label: string }> = [{ href: '/requests', label: 'My requests' }];

  if (user.role === 'MANAGER' || user.role === 'FINANCE' || user.role === 'ADMIN') {
    nav.push({ href: '/approvals', label: 'Approvals' });
  }
  if (user.role === 'FINANCE' || user.role === 'ADMIN') {
    nav.push({ href: '/finance', label: 'Finance' });
  }
  if (user.role === 'ADMIN') {
    nav.push({ href: '/admin/projects', label: 'Projects' });
  }
  if (devToolsEnabled()) {
    nav.push({ href: '/dev/mailbox', label: 'Dev mailbox' });
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/requests" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Plane className="size-4" aria-hidden />
            </span>
            <span className="hidden sm:inline">Travel Approvals</span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight">{user.fullName}</p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {user.role.toLowerCase()}
              </p>
            </div>
            <form action="/auth/sign-out" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
