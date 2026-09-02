import {
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  Hourglass,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Enums } from '@/lib/supabase/database.types';

type Status = Enums<'request_status'>;

/**
 * Colour is never the only signal: each badge carries an icon and a word.
 * Roughly 1 in 12 men has a red/green deficiency, and "approved" vs "rejected"
 * is exactly the distinction that hue alone would collapse. WCAG 1.4.1.
 */
const MAP: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  DRAFT: {
    label: 'Draft',
    icon: FileEdit,
    className: 'bg-muted text-muted-foreground border-border',
  },
  PENDING_APPROVAL: {
    label: 'Pending approval',
    icon: Hourglass,
    className: 'bg-warning/10 text-warning border-warning/30',
  },
  APPROVED: {
    label: 'Approved',
    icon: CheckCircle2,
    className: 'bg-success/10 text-success border-success/30',
  },
  REJECTED: {
    label: 'Rejected',
    icon: XCircle,
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
  CANCELLED: {
    label: 'Cancelled',
    icon: Ban,
    className: 'bg-muted text-muted-foreground border-border',
  },
  EXPIRED: {
    label: 'Expired',
    icon: Clock,
    className: 'bg-muted text-muted-foreground border-border line-through decoration-1',
  },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { label, icon: Icon, className: tone } = MAP[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

export const STATUS_LABEL: Record<Status, string> = Object.fromEntries(
  Object.entries(MAP).map(([k, v]) => [k, v.label]),
) as Record<Status, string>;
