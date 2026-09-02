'use client';

import * as React from 'react';
import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';

export interface AttachmentItem {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Upload panel for a draft.
 *
 * State is local rather than a router refresh per file: uploading three
 * receipts should not re-render the whole form three times and lose whatever
 * the user was typing in it.
 */
export function AttachmentsPanel({
  requestId,
  initial,
  readOnly = false,
}: {
  requestId: string;
  initial: AttachmentItem[];
  readOnly?: boolean;
}) {
  const [items, setItems] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);

    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append('file', file);
      try {
        const res = await fetch(`/api/requests/${requestId}/attachments`, { method: 'POST', body });
        const json = (await res.json()) as { attachment?: AttachmentItem; error?: string };
        if (!res.ok || !json.attachment) {
          toast.error(json.error ?? `Could not upload ${file.name}`);
          continue;
        }
        setItems((prev) => [...prev, json.attachment!]);
      } catch {
        toast.error(`Could not upload ${file.name}`);
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function remove(id: string) {
    const previous = items;
    setItems((prev) => prev.filter((a) => a.id !== id));
    const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setItems(previous); // put it back rather than lie about what is stored
      toast.error('Could not remove that file.');
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Attachments</CardTitle>
        <span className="text-xs text-muted-foreground">PDF, PNG, JPEG, WebP or HEIC · 10 MB</span>
      </CardHeader>
      <CardBody className="space-y-3">
        {items.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <a
                  href={`/api/attachments/${a.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {a.file_name}
                </a>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatBytes(a.size_bytes)}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => void remove(a.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${a.file_name}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing attached. Quotes and screenshots go here.
          </p>
        )}

        {!readOnly && (
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              id="attachment-input"
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
              className="sr-only"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Paperclip className="size-4" aria-hidden />
              )}
              {busy ? 'Uploading…' : 'Add files'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
