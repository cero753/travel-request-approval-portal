import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, safeFileName, sniffMimeType } from '@/lib/file-type';

export const runtime = 'nodejs';

/**
 * Attachment upload (PRD 4.4).
 *
 * The file never goes to storage under a name or type the client chose:
 *
 *  - the **bytes** decide the MIME type, not `File.type` (see file-type.ts)
 *  - the storage key is a UUID, so a filename cannot traverse or collide
 *  - the size is checked against the buffer we actually read, not the
 *    `size` the browser reported
 *
 * Uploading uses the service client because the bucket has no policy granting
 * `authenticated` any access at all — every read is a signed URL minted after
 * the check below. The authorisation is therefore done here, in full, first.
 */
export async function POST(req: NextRequest, ctx: RouteContext<'/api/requests/[id]/attachments'>) {
  const { id } = await ctx.params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('travel_requests')
    .select('id, requester_id, status')
    .eq('id', id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (request.requester_id !== user.id) {
    return NextResponse.json({ error: 'That request belongs to someone else' }, { status: 403 });
  }
  if (request.status !== 'DRAFT') {
    // Letting evidence change after a manager has been asked to judge it would
    // make the audit trail describe a request that no longer exists.
    return NextResponse.json(
      { error: 'Attachments can only be changed while the request is a draft' },
      { status: 409 },
    );
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was uploaded' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'That file is empty' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Files must be 10 MB or smaller' }, { status: 413 });
  }

  const mimeType = sniffMimeType(bytes);
  if (!mimeType) {
    return NextResponse.json(
      { error: `Only ${ALLOWED_MIME.join(', ')} files are accepted` },
      { status: 415 },
    );
  }

  const fileName = safeFileName(file.name);
  const storageKey = `${id}/${randomUUID()}`;

  const service = createServiceClient();
  const { error: uploadError } = await service.storage
    .from('attachments')
    .upload(storageKey, bytes, { contentType: mimeType, upsert: false });

  if (uploadError) {
    console.error('[attachments] upload failed', uploadError);
    return NextResponse.json({ error: 'The file could not be stored' }, { status: 500 });
  }

  const { data: row, error: insertError } = await service
    .from('attachments')
    .insert({
      request_id: id,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      storage_key: storageKey,
      uploaded_by: user.id,
    })
    .select('id, file_name, mime_type, size_bytes')
    .single();

  if (insertError || !row) {
    // Orphaned objects are invisible to the user but still cost money and still
    // contain their data, so the upload is rolled back rather than left behind.
    await service.storage.from('attachments').remove([storageKey]);
    console.error('[attachments] metadata insert failed', insertError);
    return NextResponse.json({ error: 'The file could not be recorded' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, attachment: row });
}
