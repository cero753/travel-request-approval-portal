import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { DetailTable, EmailLayout, H1, P, Panel, colors } from './layout';

export interface ApprovalRequestProps {
  requesterName: string;
  fromCity: string;
  toCity: string;
  mode: string;
  departureDate: string;
  returnDate: string | null;
  purpose: string;
  billTo: string;
  currency: string;
  totalFormatted: string;
  expenses: Array<{ category: string; description: string | null; amount: string }>;
  bookingLinks: string[];
  attachmentCount: number;
  approveUrl: string;
  rejectUrl: string;
  portalUrl: string;
  expiresOn: string;
  refToken: string;
  isReminder?: boolean;
}

/**
 * The manager-facing email. Everything here follows from one observation: the
 * fastest possible approval is a reply, because it needs no login, no VPN and
 * no click on a link that a corporate scanner may have already fetched.
 *
 * So "reply Approved" is the visual primary, and the tokenised buttons are
 * demoted to a secondary line below. The links still exist for managers who
 * prefer them, and for mail clients that make replying awkward.
 */
export function ApprovalRequestEmail(props: ApprovalRequestProps) {
  const {
    requesterName, fromCity, toCity, mode, departureDate, returnDate, purpose,
    billTo, totalFormatted, expenses, bookingLinks, attachmentCount,
    approveUrl, rejectUrl, portalUrl, expiresOn, refToken, isReminder,
  } = props;

  const route = `${fromCity} → ${toCity}`;
  const dates = returnDate ? `${departureDate} – ${returnDate}` : `${departureDate} (one way)`;

  return (
    <EmailLayout
      preview={`${requesterName}: ${route}, ${totalFormatted}. Reply Approved or Rejected.`}
      refToken={refToken}
    >
      {isReminder && (
        <Text
          style={{
            margin: '0 0 8px',
            fontSize: '12px',
            fontWeight: 700,
            color: '#b45309',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Reminder — still awaiting your decision
        </Text>
      )}

      <H1>Travel approval needed</H1>
      <P muted>
        {requesterName} has requested approval for work travel. Total estimated cost{' '}
        <strong style={{ color: colors.text }}>{totalFormatted}</strong>.
      </P>

      {/* The ten-second summary. Everything below is detail. */}
      <Panel>
        <Text style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: colors.text }}>
          {totalFormatted}
        </Text>
        <Text style={{ margin: '4px 0 0', fontSize: '14px', color: colors.text }}>{route}</Text>
        <Text style={{ margin: '2px 0 0', fontSize: '13px', color: colors.muted }}>
          {dates} · {mode.toLowerCase()} · billed to {billTo}
        </Text>
      </Panel>

      <Section
        style={{
          border: `2px solid ${colors.primary}`,
          borderRadius: '6px',
          padding: '16px',
          margin: '0 0 20px',
        }}
      >
        <Text style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: colors.text }}>
          To decide, just reply to this email.
        </Text>
        <Text style={{ margin: '8px 0 0', fontSize: '14px', color: colors.text, lineHeight: '22px' }}>
          Reply <strong>Approved</strong> or <strong>Yes</strong> to approve.
          <br />
          Reply <strong>Rejected</strong> or <strong>No</strong> to reject — add a reason on the same
          line if you like.
        </Text>
      </Section>

      <Text style={{ margin: '0 0 16px', fontSize: '13px', color: colors.muted }}>
        Prefer a link?{' '}
        <Link href={approveUrl} style={{ color: colors.success, fontWeight: 600 }}>
          Approve
        </Link>
        {'  ·  '}
        <Link href={rejectUrl} style={{ color: colors.danger, fontWeight: 600 }}>
          Reject
        </Link>
        {'  ·  '}
        <Link href={portalUrl} style={{ color: colors.primary }}>
          Open in portal
        </Link>
      </Text>

      <DetailTable
        rows={[
          ['Requester', requesterName],
          ['Route', route],
          ['Dates', dates],
          ['Mode', mode],
          ['Purpose', purpose],
          ['Bill to', billTo],
          [
            'Booking links',
            bookingLinks.length > 0 ? (
              <>
                {bookingLinks.map((url, i) => (
                  <React.Fragment key={url}>
                    {i > 0 && <br />}
                    <Link href={url} style={{ color: colors.primary, wordBreak: 'break-all' }}>
                      {truncate(url, 60)}
                    </Link>
                  </React.Fragment>
                ))}
              </>
            ) : (
              '—'
            ),
          ],
          ['Attachments', attachmentCount > 0 ? `${attachmentCount} file(s) in the portal` : '—'],
        ]}
      />

      <Text style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 600, color: colors.text }}>
        Estimated costs
      </Text>
      <table
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        style={{ borderCollapse: 'collapse', margin: '0 0 16px' }}
      >
        <tbody>
          {expenses.map((e, i) => (
            <tr key={i}>
              <td
                style={{
                  padding: '6px 0',
                  borderTop: `1px solid ${colors.border}`,
                  fontSize: '13px',
                  color: colors.text,
                }}
              >
                {labelForCategory(e.category)}
                {e.description ? (
                  <span style={{ color: colors.muted }}> — {e.description}</span>
                ) : null}
              </td>
              <td
                style={{
                  padding: '6px 0',
                  borderTop: `1px solid ${colors.border}`,
                  fontSize: '13px',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  color: colors.text,
                }}
              >
                {e.amount}
              </td>
            </tr>
          ))}
          <tr>
            <td
              style={{
                padding: '8px 0',
                borderTop: `2px solid ${colors.border}`,
                fontSize: '14px',
                fontWeight: 700,
                color: colors.text,
              }}
            >
              Total
            </td>
            <td
              style={{
                padding: '8px 0',
                borderTop: `2px solid ${colors.border}`,
                fontSize: '14px',
                fontWeight: 700,
                textAlign: 'right',
                color: colors.text,
              }}
            >
              {totalFormatted}
            </td>
          </tr>
        </tbody>
      </table>

      <P muted>This request expires on {expiresOn} if no decision is recorded.</P>
    </EmailLayout>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function labelForCategory(c: string) {
  return (
    {
      TICKET: 'Ticket',
      ACCOMMODATION: 'Accommodation',
      LOCAL_TRANSPORT: 'Local transport',
      MEALS: 'Meals',
      OTHER: 'Other',
    }[c] ?? c
  );
}

export default ApprovalRequestEmail;
