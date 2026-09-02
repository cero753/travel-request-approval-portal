'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (error) {
      // Deliberately generic: distinguishing "no such user" from "wrong
      // password" turns the login form into an employee-directory oracle.
      setError('Incorrect email or password.');
      setPending(false);
      return;
    }

    // `refresh()` first so the server re-renders with the new session cookie,
    // otherwise proxy.ts bounces us straight back to /login.
    router.refresh();
    router.replace(safeRedirect(redirectTo));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <Field label="Work email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
        />
      </Field>

      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

/**
 * `?next=` is attacker-supplied. Only same-origin absolute paths are honoured,
 * or the login page becomes an open redirect straight into a phishing page.
 * `//evil.com` is protocol-relative and must be rejected too.
 */
function safeRedirect(target: string): string {
  if (!target.startsWith('/') || target.startsWith('//')) return '/requests';
  return target;
}
