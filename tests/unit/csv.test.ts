import { describe, expect, it } from 'vitest';
import { escapeCell, toCsv } from '@/lib/csv';

/**
 * PRD AC 8, defensive half.
 *
 * The finance export is opened by Finance on a machine that has access to more
 * than this app, and every cell in it was typed by whoever filled the form.
 * These tests describe what a spreadsheet must never be handed.
 */

describe('escapeCell — formula injection', () => {
  // The full set the DDE/formula attacks start with. Excel, LibreOffice and
  // Sheets all evaluate a cell beginning with one of these.
  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'neutralises a cell starting with %j',
    (lead) => {
      const out = escapeCell(`${lead}HYPERLINK("http://evil.test")`);
      expect(out.replace(/^"|"$/g, '')).toMatch(/^'/);
    },
  );

  it('neutralises the classic command-execution payload', () => {
    expect(escapeCell('=cmd|\'/c calc\'!A1')).toBe("'=cmd|'/c calc'!A1");
  });

  it('still reads correctly to a human — only a leading apostrophe is added', () => {
    // The apostrophe is not displayed by any spreadsheet; the value is intact.
    expect(escapeCell('-500')).toBe("'-500");
  });

  it('leaves an ordinary value untouched', () => {
    expect(escapeCell('Bengaluru')).toBe('Bengaluru');
    expect(escapeCell('Client kickoff meeting')).toBe('Client kickoff meeting');
  });

  it('does not treat a dangerous character in a later position as a formula', () => {
    // Only the *first* character triggers evaluation.
    expect(escapeCell('1+1')).toBe('1+1');
    expect(escapeCell('a@b.com')).toBe('a@b.com');
  });
});

describe('escapeCell — RFC 4180 quoting', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(escapeCell('He said "go"')).toBe('"He said ""go"""');
  });

  it('quotes a value containing the delimiter', () => {
    expect(escapeCell('Bengaluru, KA')).toBe('"Bengaluru, KA"');
  });

  it('quotes a value containing a newline', () => {
    expect(escapeCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('applies the apostrophe *inside* the quotes when both rules fire', () => {
    // A cell that is both dangerous and needs quoting must not lose either
    // defence — the apostrophe has to survive the wrapping.
    const out = escapeCell('=SUM(A1,A2)');
    expect(out).toBe('"\'=SUM(A1,A2)"');
  });

  it('renders null and undefined as empty, not as the strings', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
    // Guards against a row of literal "undefined" reaching Finance.
    expect(escapeCell(0)).toBe('0');
  });
});

describe('toCsv', () => {
  it('emits CRLF line endings and a trailing newline', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);
    expect(csv).toBe('a,b\r\n1,2\r\n');
  });

  it('escapes header cells too', () => {
    // Headers are ours, but a column name is still a cell.
    expect(toCsv(['=weird'], [])).toBe("'=weird\r\n");
  });

  it('keeps rows aligned when a cell is empty', () => {
    expect(toCsv(['a', 'b', 'c'], [['1', null, '3']])).toBe('a,b,c\r\n1,,3\r\n');
  });
});
