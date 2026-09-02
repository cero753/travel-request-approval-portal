import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

/**
 * Shared chrome for every outbound email.
 *
 * Constraints that shape this: Outlook renders with Word, which ignores most
 * modern CSS, so layout is table-driven and every style is inline. Width is
 * capped at 600px because that is what the Outlook reading pane gives you.
 * There is no external CSS and no web fonts — both are stripped or blocked by
 * most clients.
 */

export const colors = {
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#2563eb',
  success: '#15803d',
  danger: '#b91c1c',
  panel: '#f8fafc',
};

export const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function EmailLayout({
  preview,
  children,
  refToken,
}: {
  preview: string;
  children: React.ReactNode;
  /** Rendered in the footer so an inbound reply can be matched back. */
  refToken?: string;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: '#f1f5f9', margin: 0, padding: '24px 0', fontFamily: fontStack }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            maxWidth: '600px',
            margin: '0 auto',
            padding: '0',
          }}
        >
          <Section style={{ padding: '20px 24px 0' }}>
            <Text
              style={{
                margin: 0,
                fontSize: '13px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: colors.muted,
              }}
            >
              Awign Travel
            </Text>
          </Section>

          <Section style={{ padding: '8px 24px 24px' }}>{children}</Section>

          <Hr style={{ borderColor: colors.border, margin: 0 }} />

          <Section style={{ padding: '16px 24px' }}>
            <Text style={{ margin: 0, fontSize: '12px', color: colors.muted, lineHeight: '18px' }}>
              This is an automated message from the Awign Travel Approval Portal.
              {refToken ? (
                <>
                  <br />
                  Ref: {refToken}
                </>
              ) : null}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: '20px', fontWeight: 700, color: colors.text, margin: '8px 0 4px' }}>
      {children}
    </Text>
  );
}

export function P({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Text
      style={{
        fontSize: '14px',
        lineHeight: '22px',
        color: muted ? colors.muted : colors.text,
        margin: '0 0 12px',
      }}
    >
      {children}
    </Text>
  );
}

/** Label/value rows. A table, because Outlook does not do flexbox. */
export function DetailTable({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <table
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ borderCollapse: 'collapse', margin: '4px 0 16px' }}
    >
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td
              style={{
                padding: '6px 12px 6px 0',
                fontSize: '13px',
                color: colors.muted,
                verticalAlign: 'top',
                whiteSpace: 'nowrap',
                width: '38%',
              }}
            >
              {label}
            </td>
            <td style={{ padding: '6px 0', fontSize: '13px', color: colors.text, fontWeight: 500 }}>
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Section
      style={{
        backgroundColor: colors.panel,
        border: `1px solid ${colors.border}`,
        borderRadius: '6px',
        padding: '14px 16px',
        margin: '0 0 16px',
      }}
    >
      {children}
    </Section>
  );
}
