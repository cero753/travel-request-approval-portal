'use client';

import * as React from 'react';
import { Check, Loader2, Plane, X } from 'lucide-react';
import { Alert, Button, Card, CardBody, Textarea } from '@/components/ui/primitives';
import { decideByTokenAction, type DecisionOutcome } from './actions';

/**
 * The confirmation step behind a decision link.
 *
 * The manager arrived here by clicking a link in an email, so this page has
 * done nothing yet — landing on it changes no state. Pressing the button below
 * is the first and only mutation, and it is a POST.
 */
export function ConfirmPanel({
  token,
  action,
  summary,
}: {
  token: string;
  action: 'APPROVE' | 'REJECT';
  summary: {
    requester: string;
    route: string;
    dates: string;
    total: string;
    billTo: string;
    purpose: string;
  };
}) {
  const [pending, startTransition] = React.useTransition();
  const [reason, setReason] = React.useState('');
  const [outcome, setOutcome] = React.useState<DecisionOutcome | null>(null);

  const isReject = action === 'REJECT';

  if (outcome) return <Outcome outcome={outcome} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Plane className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {summary.route}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {summary.requester} · {summary.dates}
              </p>
            </div>
            <p className="shrink-0 font-mono text-xl font-semibold tabular-nums">{summary.total}</p>
          </div>

          <div className="border-t border-border pt-3 text-sm">
            <p className="text-muted-foreground">Bill to</p>
            <p>{summary.billTo}</p>
            <p className="mt-2 text-muted-foreground">Purpose</p>
            <p className="whitespace-pre-wrap">{summary.purpose}</p>
          </div>
        </CardBody>
      </Card>

      {isReject && (
        <div className="space-y-1.5">
          <label htmlFor="reason" className="text-sm font-medium">
            Reason for rejection
          </label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The requester will see this."
          />
        </div>
      )}

      <Button
        variant={isReject ? 'destructive' : 'success'}
        size="lg"
        className="w-full"
        disabled={pending || (isReject && reason.trim().length < 3)}
        onClick={() =>
          startTransition(async () => {
            setOutcome(await decideByTokenAction(token, isReject ? reason : null));
          })
        }
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : isReject ? (
          <X aria-hidden />
        ) : (
          <Check aria-hidden />
        )}
        {isReject ? 'Confirm rejection' : 'Confirm approval'}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Nothing has been recorded yet. This link works once.
      </p>
    </div>
  );
}

function Outcome({ outcome }: { outcome: DecisionOutcome }) {
  if (outcome.status === 'applied') {
    return (
      <Alert variant={outcome.decision === 'APPROVED' ? 'success' : 'info'}>
        <p className="font-medium">
          {outcome.decision === 'APPROVED' ? 'Approved.' : 'Rejected.'}
        </p>
        <p className="mt-1">
          The requester has been notified and the decision is on the record. You can close this
          page.
        </p>
      </Alert>
    );
  }

  if (outcome.status === 'already_decided') {
    return (
      <Alert variant="warning">
        <p className="font-medium">
          This request was already {(outcome.finalStatus ?? 'decided').toLowerCase().replace('_', ' ')}.
        </p>
        <p className="mt-1">
          Your click was not applied — the earlier decision stands. That is usually because a reply
          to the email arrived first.
        </p>
      </Alert>
    );
  }

  return <Alert variant="error">{outcome.reason}</Alert>;
}
