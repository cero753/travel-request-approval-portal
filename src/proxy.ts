import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Formerly `middleware.ts` — Next.js 16 deprecated that convention and renamed
 * it to `proxy.ts` (see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/middleware.md).
 *
 * Two jobs: refresh the Supabase session cookie, and gate routes by role.
 *
 * Note what is NOT in the matcher: `/api/webhooks/*`. The inbound webhook
 * verifies a Svix signature over the raw request body, and anything that reads
 * or rewrites the body upstream can invalidate it. It also has no session and
 * must stay reachable while signed out. Same for `/api/cron/*`, which
 * authenticates with a bearer secret instead.
 */

/** Signed-out users may reach these; everything else needs a session. */
const PUBLIC_PREFIXES = ['/login', '/auth', '/approve', '/reject', '/api/health'];

/** Role-gated areas. Checked here for UX; RLS and route handlers enforce it for real. */
const ROLE_PREFIXES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: '/finance', roles: ['FINANCE', 'ADMIN'] },
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/approvals', roles: ['MANAGER', 'FINANCE', 'ADMIN'] },
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The dev mailbox can forge approvals. Two independent gates (here and in the
  // route itself) so a matcher mistake alone cannot expose it.
  if (pathname.startsWith('/dev')) {
    const enabled = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_TOOLS === 'true';
    if (!enabled) return new NextResponse('Not found', { status: 404 });
  }

  // `response` is reassigned by setAll below so refreshed auth cookies survive.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not remove: this call is what refreshes an expired token. Anything
  // between createServerClient and here risks logging the user out at random.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic && pathname !== '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Round-trip the destination so login lands them where they meant to go.
    url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/requests';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user) {
    const gate = ROLE_PREFIXES.find(
      ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (gate) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!profile || !gate.roles.includes(profile.role)) {
        const url = request.nextUrl.clone();
        url.pathname = '/requests';
        url.search = '';
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/webhooks - raw body + Svix signature, must not be touched
     *   api/cron     - bearer-secret auth, no session
     *   _next/*      - build output
     *   static assets
     */
    '/((?!api/webhooks|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
