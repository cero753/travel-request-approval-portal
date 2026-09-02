import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Service-role client. **Bypasses RLS entirely.**
 *
 * The `import 'server-only'` above is the load-bearing line: it makes the build
 * fail if any file in a Client Component's import graph reaches this module,
 * which is the only realistic way this key ends up in a browser bundle.
 *
 * Legitimate callers are exactly the paths where no user session exists:
 *   - the inbound email webhook (the "user" is a mail server)
 *   - the cron routes (reminders, expiry)
 *   - the seed script
 *   - approval-token redemption (the manager is not logged in — that is the point)
 *
 * Anything reachable from a page render should use `server.ts` instead, so that
 * RLS stays as the backstop when the application logic is wrong.
 */

let cached: SupabaseClient<Database> | null = null;

export function createServiceClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  cached = createSupabaseClient<Database>(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // No user, no cookies, nothing to persist or refresh. Leaving these on
        // makes the client try to write a session to a non-existent store.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );

  return cached;
}
