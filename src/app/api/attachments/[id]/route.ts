import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * Redirects to a 60-second signed URL for one attachment.
 *
 * The signed URL is minted only after re-reading the parent request through the
 * **user-scoped** client: if RLS will not show them the request, they do not get
 * a link to its receipts. The window is deliberately short — these URLs are
 * unauthenticated once issued, and they end up in browser history, referrer
 * headers and screen shares.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/attachments/[id]'>) {
  const { id } = await ctx.params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const service = createServiceClient();
  const { data: attachment } = await service
    .from('attachments')
    .select('id, request_id, storage_key, file_name')
    .eq('id', id)
    .maybeSingle();

  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const supabase = await createClient();
  const { data: visible } = await supabase
    .from('travel_requests')
    .select('id')
    .eq('id', attachment.request_id)
    .maybeSingle();

  if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: signed, error } = await service.storage
    .from('attachments')
    .createSignedUrl(attachment.storage_key, 60, { download: attachment.file_name });

  if (error || !signed) {
    console.error('[attachments] could not sign url', error);
    return NextResponse.json({ error: 'Could not open that file' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}

/** Removing an attachment is only possible while the request is still a draft. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/attachments/[id]'>) {
  const { id } = await ctx.params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const service = createServiceClient();
  const { data: attachment } = await service
    .from('attachments')
    .select('id, request_id, storage_key')
    .eq('id', id)
    .maybeSingle();

  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select('id, requester_id, status')
    .eq('id', attachment.request_id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (request.requester_id !== user.id) {
    return NextResponse.json({ error: 'That request belongs to someone else' }, { status: 403 });
  }
  if (request.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Attachments can only be changed while the request is a draft' },
      { status: 409 },
    );
  }

  // Row first: a missing storage object shows as a broken link, but a missing
  // row with the object still present is a file nothing will ever clean up.
  await service.from('attachments').delete().eq('id', id);
  await service.storage.from('attachments').remove([attachment.storage_key]);

  return NextResponse.json({ ok: true });
}
