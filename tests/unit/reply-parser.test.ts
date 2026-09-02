import { describe, it, expect } from 'vitest';
import { parseApprovalReply, htmlToText, stripQuotedText, stripSignature } from '@/lib/email/reply-parser';
import { FIXTURES } from './reply-parser.fixtures';

describe('parseApprovalReply', () => {
  it.each(FIXTURES.map((f) => [f.n, f.name, f] as const))(
    '#%i %s',
    (_n, _name, f) => {
      const result = parseApprovalReply(f.input);

      expect(
        result.verdict,
        [
          `expected "${f.expect}" but got "${result.verdict}"`,
          f.why ? `why this matters: ${f.why}` : '',
          `visibleText: ${JSON.stringify(result.visibleText)}`,
          `notes: ${result.notes.join(' | ')}`,
        ]
          .filter(Boolean)
          .join('\n'),
      ).toBe(f.expect);

      if (f.isAutoReply !== undefined) {
        expect(result.isAutoReply, `notes: ${result.notes.join(' | ')}`).toBe(f.isAutoReply);
      }
      if (f.reasonContains) {
        expect(result.reason ?? '').toContain(f.reasonContains);
      }
    },
  );

  it('never returns approve or reject without a matched rule', () => {
    for (const f of FIXTURES) {
      const r = parseApprovalReply(f.input);
      if (r.verdict === 'approve' || r.verdict === 'reject') {
        expect(r.matchedRule, `#${f.n} ${f.name}`).toBeTruthy();
        expect(r.matchedPhrase, `#${f.n} ${f.name}`).toBeTruthy();
        expect(r.confidence, `#${f.n} ${f.name}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('is pure: same input yields identical output', () => {
    for (const f of FIXTURES) {
      expect(parseApprovalReply(f.input)).toEqual(parseApprovalReply(f.input));
    }
  });

  // The property that actually protects the business: our own outbound
  // instruction text, on its own, must never read as a decision.
  it('does not treat our own instruction copy as a manager decision', () => {
    const instruction =
      'To approve, simply reply to this email with Approved or Yes. To reject, reply with Rejected or No.';
    expect(parseApprovalReply({ text: instruction }).verdict).not.toBe('approve');
    expect(parseApprovalReply({ text: instruction }).verdict).not.toBe('reject');
  });
});

describe('htmlToText', () => {
  it('removes nested blockquote subtrees entirely', () => {
    const out = htmlToText('<p>keep</p><blockquote><blockquote>drop</blockquote>drop2</blockquote>');
    expect(out).toContain('keep');
    expect(out).not.toContain('drop');
  });

  it('drops everything from an unbalanced blockquote onward', () => {
    const out = htmlToText('<p>keep</p><blockquote>runaway quote');
    expect(out).toContain('keep');
    expect(out).not.toContain('runaway');
  });

  it('strips script and style content', () => {
    expect(htmlToText('<style>p{color:red}</style><p>hi</p>')).not.toContain('color');
    expect(htmlToText('<script>alert(1)</script><p>hi</p>')).not.toContain('alert');
  });
});

describe('stripQuotedText', () => {
  it('cuts at a wrapped "On ... wrote:" attribution spanning two lines', () => {
    const { visible } = stripQuotedText(
      'Approved.\n\nOn Mon, 1 Sep 2026 at 18:04, Awign Travel\n<approvals@awign.example> wrote:\n> original',
    );
    expect(visible).toContain('Approved.');
    expect(visible).not.toContain('original');
  });

  it('cuts at an Outlook From: header block', () => {
    const { visible } = stripQuotedText('No.\n\nFrom: Awign Travel\nSent: today\nSubject: x');
    expect(visible.trim()).toBe('No.');
  });
});

describe('stripSignature', () => {
  it('never strips the entire body', () => {
    expect(stripSignature('-- \nonly a signature')).toBeTruthy();
    expect(stripSignature('Sent from my iPhone')).toBeTruthy();
  });

  it('keeps the decision when a sign-off follows it', () => {
    expect(stripSignature('Approved.\n\nRegards,\nPriya')).toContain('Approved');
  });
});
