import {
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  Mail,
  MailQuestion,
  MessageSquareReply,
  Send,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import type { AuditRow } from './queries';

/**
 * PRD 4.9 — the audit log, rendered as a vertical timeline.
 *
 * Every row states three things: what happened, who caused it, and **through
 * which channel**. The channel is the part a spreadsheet never captured, and
 * it is the whole reason this system is more defensible than the email thread
 * it replaces — "approved by email reply" and "approved by clicking a link"
 * are different evidence.
 *
 * Unknown event names render with their raw key rather than being hidden. An
 * audit trail that silently drops what it does not recognise is not an audit
 * trail.
 */

const MUTED = 'text-muted-foreground';

/** Keys are the exact strings written by 0006_state_machine_functions.sql and
 *  by the audit() helpers in send.ts / process.ts — not a parallel vocabulary. */
const EVENTS: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  'request.submitted': { label: 'Submitted for approval', icon: Send, tone: 'text-primary' },
  'request.approved': { label: 'Approved', icon: CheckCircle2, tone: 'text-success' },
  'request.rejected': { label: 'Rejected', icon: XCircle, tone: 'text-destructive' },
  'request.cancelled': { label: 'Cancelled by requester', icon: Ban, tone: MUTED },
  'request.expired': { label: 'Expired without a decision', icon: Clock, tone: MUTED },

  'decision.ignored_not_pending': {
    label: 'A second decision arrived and was not applied',
    icon: ShieldAlert,
    tone: 'text-warning',
  },

  'email.approval_request_sent': { label: 'Approval email sent', icon: Mail, tone: MUTED },
  'email.reminder_sent': { label: 'Reminder sent', icon: Mail, tone: MUTED },
  'email.decision_notice_sent': { label: 'Requester notified', icon: Mail, tone: MUTED },
  'email.expiry_notice_sent': { label: 'Expiry notice sent', icon: Mail, tone: MUTED },
  'reminder.due': { label: 'Reminder became due', icon: Clock, tone: MUTED },

  'clarification.sent': { label: 'Clarification requested', icon: MailQuestion, tone: 'text-warning' },
  'clarification.suppressed': {
    label: 'Clarification suppressed — limit reached',
    icon: MailQuestion,
    tone: MUTED,
  },
  'clarification.send_failed': {
    label: 'Clarification could not be sent',
    icon: ShieldAlert,
    tone: 'text-destructive',
  },

  'inbound.decision_applied': {
    label: 'Reply applied as a decision',
    icon: MessageSquareReply,
    tone: 'text-primary',
  },
  'inbound.decision_not_applied': {
    label: 'Reply arrived but the decision was already made',
    icon: ShieldAlert,
    tone: 'text-warning',
  },
  'inbound.sender_mismatch': {
    label: 'Reply ignored — not from the named approver',
    icon: ShieldAlert,
    tone: 'text-destructive',
  },
  'inbound.authentication_failed': {
    label: 'Reply ignored — failed SPF/DKIM/DMARC',
    icon: ShieldAlert,
    tone: 'text-destructive',
  },
  'inbound.auto_reply_ignored': { label: 'Automatic reply ignored', icon: MailQuestion, tone: MUTED },
  'inbound.reply_after_decision': {
    label: 'Reply arrived after the request was closed',
    icon: MailQuestion,
    tone: MUTED,
  },
  'inbound.fetch_gave_up': {
    label: 'Could not retrieve the reply body',
    icon: ShieldAlert,
    tone: 'text-destructive',
  },
  'inbound.unmatched': {
    label: 'A reply could not be matched to any request',
    icon: ShieldAlert,
    tone: 'text-warning',
  },
};

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL_REPLY: 'by email reply',
  LINK: 'by decision link',
  PORTAL: 'in the portal',
  SYSTEM: 'automatically',
};

export function AuditTimeline({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-0">
      {rows.map((row, index) => {
        const meta = EVENTS[row.event] ?? {
          label: row.event,
          icon: FileEdit,
          tone: 'text-muted-foreground',
        };
        const Icon = meta.icon;
        const isLast = index === rows.length - 1;
        const detail = describe(row);

        return (
          <li key={row.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* The rail stops at the last entry so the timeline reads as ended. */}
            {!isLast && (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border"
                aria-hidden
              />
            )}
            <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <Icon className={`size-3.5 ${meta.tone}`} aria-hidden />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight">{meta.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDateTime(row.created_at)}
                {row.actor_email && ` · ${row.actor_email}`}
                {row.channel && ` · ${CHANNEL_LABEL[row.channel] ?? row.channel}`}
              </p>
              {detail && (
                <p className="mt-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                  {detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Pulls the one or two metadata fields worth surfacing, without dumping JSON. */
function describe(row: AuditRow): string | null {
  const meta = row.metadata_json;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const record = meta as Record<string, unknown>;

  const parts: string[] = [];
  const reason = str(record.reason);
  if (reason) parts.push(`“${reason}”`);

  const verdict = str(record.verdict);
  if (verdict && !reason) parts.push(`Parsed as: ${verdict}`);

  const rule = str(record.matched_rule);
  if (rule) parts.push(`rule: ${rule}`);

  const from = str(record.from_email);
  if (from) parts.push(`from ${from}`);

  const strategy = str(record.match_strategy);
  if (strategy) parts.push(`matched by ${strategy}`);

  return parts.length ? parts.join(' · ') : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
