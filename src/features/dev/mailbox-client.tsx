'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Play, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/utils';
import {
  backdateRequestAction,
  resetReminderAction,
  runCronAction,
  simulateReplyAction,
} from './actions';

export interface SentMail {
  id: string;
  to_email: string;
  from_email: string;
  reply_to: string | null;
  subject: string;
  html: string | null;
  text_body: string | null;
  kind: string | null;
  request_id: string | null;
  created_at: string;
}

export interface PendingRequest {
  id: string;
  label: string;
  managerEmail: string | null;
  status: string;
}

const PRESETS: Array<{ label: string; body: string }> = [
  { label: 'Approved', body: 'Approved.' },
  { label: 'Yes, go ahead', body: 'Yes, go ahead. Thanks.' },
  { label: 'Rejected + reason', body: 'Rejected. Book the 6am flight instead, it is half the fare.' },
  { label: 'Ambiguous', body: 'I approve the flight but reject the hotel.' },
  { label: 'Out of office', body: 'I am out of office until Monday. Approved requests will be handled then.' },
];

export function MailboxClient({
  mail,
  requests,
}: {
  mail: SentMail[];
  requests: PendingRequest[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [selected, setSelected] = React.useState(mail[0]?.id ?? null);

  const [requestId, setRequestId] = React.useState(requests[0]?.id ?? '');
  const [body, setBody] = React.useState('Approved.');
  const [fromOverride, setFromOverride] = React.useState('');
  const [htmlOnly, setHtmlOnly] = React.useState(false);
  const [bottomPost, setBottomPost] = React.useState(false);
  const [asAutoReply, setAsAutoReply] = React.useState(false);
  const [deliverTwice, setDeliverTwice] = React.useState(false);
  const [omitPlusAddress, setOmitPlusAddress] = React.useState(false);
  const [omitQuote, setOmitQuote] = React.useState(false);
  const [failFetches, setFailFetches] = React.useState(0);
  const [backdateDays, setBackdateDays] = React.useState(4);
  const [log, setLog] = React.useState<string[]>([]);

  const open = mail.find((m) => m.id === selected) ?? null;

  function note(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${line}`, ...prev].slice(0, 12));
  }

  function send() {
    if (!requestId) return void toast.error('Pick a request first.');
    startTransition(async () => {
      const res = await simulateReplyAction({
        requestId,
        body,
        fromOverride: fromOverride.trim() || undefined,
        htmlOnly,
        bottomPost,
        asAutoReply,
        deliverTwice,
        omitPlusAddress,
        omitQuote,
        failFetches,
      });
      if (!res.ok) {
        note(`FAILED: ${res.error}`);
        toast.error(res.error);
        return;
      }
      note(`webhook ${res.result.status} · ${res.result.responseBody.slice(0, 160)}`);
      toast.success('Reply delivered to the webhook.');
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Reply as the manager</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dev-request">Request</Label>
              <Select
                id="dev-request"
                value={requestId}
                onChange={(e) => setRequestId(e.target.value)}
              >
                {requests.length === 0 && <option value="">No pending requests</option>}
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setBody(p.body)}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-body">Reply text</Label>
              <Textarea id="dev-body" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-from">From (blank = the real approver)</Label>
              <Input
                id="dev-from"
                value={fromOverride}
                onChange={(e) => setFromOverride(e.target.value)}
                placeholder="someone.else@awign.example"
              />
            </div>

            <fieldset className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border p-2.5">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Awkward cases
              </legend>
              <Toggle label="HTML only" checked={htmlOnly} onChange={setHtmlOnly} />
              <Toggle label="Bottom post" checked={bottomPost} onChange={setBottomPost} />
              <Toggle label="Auto-reply" checked={asAutoReply} onChange={setAsAutoReply} />
              <Toggle label="Deliver twice" checked={deliverTwice} onChange={setDeliverTwice} />
              <Toggle label="No plus tag" checked={omitPlusAddress} onChange={setOmitPlusAddress} />
              <Toggle label="No quote" checked={omitQuote} onChange={setOmitQuote} />
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="dev-fail">Fail the body fetch N times</Label>
              <Input
                id="dev-fail"
                type="number"
                min={0}
                max={8}
                value={failFetches}
                onChange={(e) => setFailFetches(Number(e.target.value) || 0)}
              />
            </div>

            <Button type="button" className="w-full" disabled={pending} onClick={send}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Deliver reply
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduled jobs</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dev-backdate">Move this request back (days)</Label>
              <div className="flex gap-2">
                <Input
                  id="dev-backdate"
                  type="number"
                  min={1}
                  max={30}
                  value={backdateDays}
                  onChange={(e) => setBackdateDays(Number(e.target.value) || 1)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !requestId}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await backdateRequestAction(requestId, backdateDays);
                      note(res.ok ? `backdated ${backdateDays}d` : `backdate failed: ${res.error}`);
                      router.refresh();
                    })
                  }
                >
                  Backdate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expiry is {backdateDays} days closer, so the jobs below have something to claim.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await runCronAction('reminders');
                    note(`cron/reminders ${res.status} · ${res.body.slice(0, 160)}`);
                    router.refresh();
                  })
                }
              >
                <Play aria-hidden />
                Run reminders
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await runCronAction('expire');
                    note(`cron/expire ${res.status} · ${res.body.slice(0, 160)}`);
                    router.refresh();
                  })
                }
              >
                <Play aria-hidden />
                Run expiry
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || !requestId}
                onClick={() =>
                  startTransition(async () => {
                    const res = await resetReminderAction(requestId);
                    note(res.ok ? 'reminder flag cleared' : `failed: ${res.error}`);
                    router.refresh();
                  })
                }
              >
                <RotateCcw aria-hidden />
                Reset reminder flag
              </Button>
            </div>
          </CardBody>
        </Card>

        {log.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Log</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                {log.map((line, i) => (
                  <li key={i} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {mail.slice(0, 12).map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              variant={m.id === selected ? 'default' : 'outline'}
              onClick={() => setSelected(m.id)}
            >
              {m.kind ?? 'EMAIL'} · {formatDateTime(m.created_at).slice(-8)}
            </Button>
          ))}
        </div>

        {!open ? (
          <Alert>
            Nothing sent yet. Submit a request and the approval email lands here.
          </Alert>
        ) : (
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle>{open.subject}</CardTitle>
              <p className="font-mono text-xs text-muted-foreground">
                to {open.to_email} · from {open.from_email}
                {open.reply_to && ` · reply-to ${open.reply_to}`}
              </p>
              {open.request_id && (
                <Link
                  href={`/requests/${open.request_id}`}
                  className="text-xs text-primary hover:underline"
                >
                  Open the request →
                </Link>
              )}
            </CardHeader>
            <CardBody className="p-0">
              {/* Sandboxed: this HTML is rendered by a mail client in production
                  and must not be able to touch this origin's session here. */}
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={open.html ?? `<pre>${escapeHtml(open.text_body ?? '')}</pre>`}
                className="h-[36rem] w-full rounded-b-lg border-0 bg-white"
              />
            </CardBody>
          </Card>
        )}

        {open?.text_body && (
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">Plain-text part</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">
              {open.text_body}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 rounded border-border"
      />
      {label}
    </label>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
