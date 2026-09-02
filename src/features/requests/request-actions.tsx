'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2, Mail, Ban, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Textarea } from '@/components/ui/primitives';
import {
  cancelRequestAction,
  decideInPortalAction,
  duplicateRequestAction,
  resendApprovalEmailAction,
} from './actions';

/**
 * Everything on the detail page that mutates.
 *
 * Which buttons exist is decided on the **server** and passed in as flags —
 * this component never derives authority from the role it was handed, because
 * a client component's props are only ever a rendering hint. The actions
 * themselves re-check identity and status regardless (see actions.ts).
 */
export function RequestActions({
  requestId,
  canCancel,
  canResend,
  canDuplicate,
  canDecide,
}: {
  requestId: string;
  canCancel: boolean;
  canResend: boolean;
  canDuplicate: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? 'Something went wrong.');
        // Refresh anyway: "already decided" means this page is showing stale
        // state, and the honest fix is to go and read the row again.
        router.refresh();
      }
    });
  }

  if (!canCancel && !canResend && !canDuplicate && !canDecide) return null;

  return (
    <div className="space-y-3">
      {canDecide && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">You are the approver on this request.</p>

          {!rejecting ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="success"
                disabled={pending}
                onClick={() =>
                  run(() => decideInPortalAction(requestId, 'APPROVED', null), 'Approved.')
                }
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                Approve
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => setRejecting(true)}>
                <X aria-hidden />
                Reject
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="reject-reason" className="text-sm font-medium">
                Why are you rejecting this? The requester will see it.
              </label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Book the 6am flight instead — it is half the fare."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={pending || reason.trim().length < 3}
                  onClick={() =>
                    run(
                      () => decideInPortalAction(requestId, 'REJECTED', reason),
                      'Rejected. The requester has been notified.',
                    )
                  }
                >
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
                  Confirm rejection
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canResend && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => resendApprovalEmailAction(requestId), 'Approval email sent again.')
            }
          >
            <Mail aria-hidden />
            Resend approval email
          </Button>
        )}

        {canDuplicate && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await duplicateRequestAction(requestId);
                if (result.ok) {
                  toast.success('Copied into a new draft.');
                  router.push(`/requests/${result.data.id}/edit`);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            <Copy aria-hidden />
            Duplicate to new request
          </Button>
        )}

        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm('Cancel this request? This cannot be undone.')) return;
              run(() => cancelRequestAction(requestId), 'Request cancelled.');
            }}
          >
            <Ban aria-hidden />
            Cancel request
          </Button>
        )}
      </div>
    </div>
  );
}
