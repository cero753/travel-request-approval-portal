'use server';

import { revalidatePath } from 'next/cache';
import { devToolsEnabled } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateInboundReply, type SimulateOptions } from '@/lib/email/dev/simulate-inbound';

/**
 * Dev-mailbox actions.
 *
 * Every export starts with the same guard. proxy.ts already 404s `/dev/*` in
 * production, but a server action is reachable by its own POST endpoint without
 * ever loading the page that declares it — a matcher is not a gate for these.
 * This code can forge an approval, so it gets its own lock.
 */

function assertDev() {
  if (!devToolsEnabled()) throw new Error('Dev tools are disabled.');
}

export interface SimulateFormInput extends Omit<SimulateOptions, 'requestId'> {
  requestId: string;
}

export async function simulateReplyAction(
  input: SimulateFormInput,
): Promise<{ ok: true; result: Awaited<ReturnType<typeof simulateInboundReply>> } | { ok: false; error: string }> {
  assertDev();
  try {
    const result = await simulateInboundReply(input);
    revalidatePath('/dev/mailbox');
    revalidatePath('/requests');
    revalidatePath(`/requests/${input.requestId}`);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Moves a request's clock backwards so the reminder and expiry jobs have
 * something to claim. Without this, testing expiry means waiting seven days.
 */
export async function backdateRequestAction(
  requestId: string,
  days: number,
): Promise<{ ok: boolean; error?: string }> {
  assertDev();

  const supabase = createServiceClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select('submitted_at, expires_at')
    .eq('id', requestId)
    .maybeSingle();

  if (!request?.submitted_at || !request.expires_at) {
    return { ok: false, error: 'Only a submitted request has a clock to move.' };
  }

  const shift = days * 86_400_000;
  const { error } = await supabase
    .from('travel_requests')
    .update({
      submitted_at: new Date(new Date(request.submitted_at).getTime() - shift).toISOString(),
      expires_at: new Date(new Date(request.expires_at).getTime() - shift).toISOString(),
    })
    .eq('id', requestId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dev/mailbox');
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}

/** Clears `reminder_sent_at` so the reminder job can claim the row again. */
export async function resetReminderAction(requestId: string): Promise<{ ok: boolean; error?: string }> {
  assertDev();
  const { error } = await createServiceClient()
    .from('travel_requests')
    .update({ reminder_sent_at: null })
    .eq('id', requestId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dev/mailbox');
  return { ok: true };
}

/** Runs a cron route through real HTTP, secret and all — not by calling the RPC. */
export async function runCronAction(job: 'reminders' | 'expire'): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  assertDev();

  const { serverEnv, publicEnv } = await import('@/lib/env');
  const res = await fetch(`${publicEnv().NEXT_PUBLIC_APP_URL}/api/cron/${job}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${serverEnv().CRON_SECRET}` },
  });

  const body = await res.text();
  revalidatePath('/dev/mailbox');
  revalidatePath('/requests');
  return { ok: res.ok, status: res.status, body };
}
