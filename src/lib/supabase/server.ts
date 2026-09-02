import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Request-scoped client for Server Components, Server Actions and Route Handlers.
 * Anon key + the user's cookies, so RLS still applies. Never use this for
 * webhook or cron work — there is no user there; use `service.ts`.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = publicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The refreshed session is
            // written by proxy.ts on the next request instead, so swallowing
            // this is correct rather than merely convenient.
          }
        },
      },
    },
  );
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Database['public']['Enums']['app_role'];
  managerEmail: string | null;
}

/**
 * The signed-in user and their profile, or null.
 *
 * Uses `getUser()`, never `getSession()`. `getSession()` returns whatever the
 * cookie claims without contacting the auth server — fine for "is a session
 * present?", useless for authorisation, because the role in that payload is
 * attacker-controlled. Everything here feeds RBAC, so it must be verified.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, manager_email, active')
    .eq('id', user.id)
    .single();

  // A profile row is created by an auth.users trigger, so absence means the
  // account was deactivated or hand-deleted. Treat it as not-signed-in.
  if (!profile || !profile.active) return null;

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    managerEmail: profile.manager_email,
  };
}
