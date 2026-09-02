import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { DetailTable, EmailLayout, H1, P, Panel, colors } from './layout';

/** Sent to the requester once a decision lands, whatever the channel. */
export interface DecisionNoticeProps {
  requesterName: string;
  decision: 'APPROVED' | 'REJECTED';
  decidedBy: string;
  decidedVia: string;
  reason: string | null;
  route: string;
  dates: string;
  totalFormatted: string;
  portalUrl: string;
  refToken: string;
}

export function DecisionNoticeEmail(props: DecisionNoticeProps) {
  const approved = props.decision === 'APPROVED';
  const tone = approved ? colors.success : colors.danger;

  return (
    <EmailLayout
      preview={`Your travel request was ${approved ? 'approved' : 'rejected'} — ${props.route}`}
      refToken={props.refToken}
    >
      <H1>Travel request {approved ? 'approved' : 'rejected'}</H1>
      <P muted>Hi {props.requesterName},</P>

      <Panel>
        <Text style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: tone }}>
          {approved ? '✓ Approved' : '✕ Rejected'} by {props.decidedBy}
        </Text>
        <Text style={{ margin: '4px 0 0', fontSize: '13px', color: colors.muted }}>
          {props.route} · {props.dates} · {props.totalFormatted}
        </Text>
      </Panel>

      {props.reason && (
        <>
          <Text style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: colors.text }}>
            {approved ? 'Note from your manager' : 'Reason given'}
          </Text>
          <P>{props.reason}</P>
        </>
      )}

      {approved ? (
        <P>You can go ahead and book. Keep your receipts for the expense claim.</P>
      ) : (
        <P>
          No booking should be made. You can duplicate this request from the portal and resubmit
          with changes.
        </P>
      )}

      <DetailTable rows={[['Decision recorded via', props.decidedVia]]} />

      <Section>
        <Link href={props.portalUrl} style={{ color: colors.primary, fontWeight: 600, fontSize: '14px' }}>
          View the request →
        </Link>
      </Section>
    </EmailLayout>
  );
}

/**
 * Sent when a reply arrived but did not clearly say approve or reject.
 *
 * Never sent in response to a detected auto-reply, and capped per request:
 * an out-of-office that answers our clarification with another out-of-office
 * is a mail loop, and mail loops get domains blocked.
 */
export interface ClarificationProps {
  managerName: string;
  requesterName: string;
  route: string;
  totalFormatted: string;
  whatTheySaid: string;
  approveUrl: string;
  rejectUrl: string;
  portalUrl: string;
  refToken: string;
}

export function ClarificationEmail(props: ClarificationProps) {
  return (
    <EmailLayout
      preview={`We could not read your reply — ${props.route}`}
      refToken={props.refToken}
    >
      <H1>Sorry — we could not read your reply</H1>
      <P muted>
        Your reply about {props.requesterName}&apos;s travel request ({props.route},{' '}
        {props.totalFormatted}) did not clearly say approve or reject, so nothing has changed.
      </P>

      {props.whatTheySaid && (
        <Panel>
          <Text style={{ margin: 0, fontSize: '12px', color: colors.muted }}>You wrote:</Text>
          <Text style={{ margin: '4px 0 0', fontSize: '13px', color: colors.text, fontStyle: 'italic' }}>
            “{props.whatTheySaid}”
          </Text>
        </Panel>
      )}

      <Section
        style={{
          border: `2px solid ${colors.primary}`,
          borderRadius: '6px',
          padding: '16px',
          margin: '0 0 16px',
        }}
      >
        <Text style={{ margin: 0, fontSize: '14px', color: colors.text, lineHeight: '22px' }}>
          Reply with just <strong>Approved</strong> or just <strong>Rejected</strong> — a single word
          on its own line is enough. Add a reason after it if you want one recorded.
        </Text>
      </Section>

      <Text style={{ margin: 0, fontSize: '13px', color: colors.muted }}>
        Or use a link:{' '}
        <Link href={props.approveUrl} style={{ color: colors.success, fontWeight: 600 }}>
          Approve
        </Link>
        {'  ·  '}
        <Link href={props.rejectUrl} style={{ color: colors.danger, fontWeight: 600 }}>
          Reject
        </Link>
        {'  ·  '}
        <Link href={props.portalUrl} style={{ color: colors.primary }}>
          Open in portal
        </Link>
      </Text>
    </EmailLayout>
  );
}

/** Sent to the requester when nobody decided in time. */
export interface ExpiryNoticeProps {
  requesterName: string;
  managerEmail: string;
  route: string;
  dates: string;
  totalFormatted: string;
  portalUrl: string;
  refToken: string;
}

export function ExpiryNoticeEmail(props: ExpiryNoticeProps) {
  return (
    <EmailLayout preview={`Travel request expired — ${props.route}`} refToken={props.refToken}>
      <H1>Travel request expired</H1>
      <P muted>Hi {props.requesterName},</P>
      <P>
        Your request for {props.route} ({props.dates}, {props.totalFormatted}) expired without a
        decision from {props.managerEmail}.
      </P>
      <P>
        Nothing was approved and no booking should be made. If the trip is still needed, duplicate
        the request in the portal and resubmit — the original stays on file unchanged.
      </P>
      <Section>
        <Link href={props.portalUrl} style={{ color: colors.primary, fontWeight: 600, fontSize: '14px' }}>
          Duplicate and resubmit →
        </Link>
      </Section>
    </EmailLayout>
  );
}
