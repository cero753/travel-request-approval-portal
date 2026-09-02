import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/server';

// proxy.ts already redirects "/" for signed-in users; this covers direct
// server-side hits and keeps the behaviour true if the matcher ever changes.
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? '/requests' : '/login');
}
