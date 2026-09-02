'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { ActionResult } from '@/features/requests/actions';

/**
 * Project administration.
 *
 * The role check is repeated here even though RLS restricts writes on
 * `projects` to admins. The action returns a sentence a human can read; RLS
 * returns a policy violation. Both should hold, and only one of them is worth
 * showing to someone.
 */

const projectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'A code needs at least two characters')
    .max(60)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dots, dashes or underscores'),
  name: z.string().trim().min(2, 'Give the project a name').max(200),
});

export async function createProjectAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };
  if (user.role !== 'ADMIN') return { ok: false, error: 'Only an admin can manage projects.' };

  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: 'Check the code and name.', fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({ code: parsed.data.code, name: parsed.data.name })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That code already exists.' };
    return { ok: false, error: error.message };
  }

  revalidatePath('/admin/projects');
  return { ok: true, data: { id: data.id } };
}

/**
 * Toggles a code on or off. There is deliberately no delete: requests already
 * reference the code, and removing it would silently rewrite history.
 */
export async function setProjectActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };
  if (user.role !== 'ADMIN') return { ok: false, error: 'Only an admin can manage projects.' };

  const supabase = await createClient();
  const { error } = await supabase.from('projects').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/projects');
  return { ok: true, data: undefined };
}
