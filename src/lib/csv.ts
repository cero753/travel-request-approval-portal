/**
 * CSV writing with formula-injection defence.
 *
 * Excel, LibreOffice and Google Sheets all evaluate a cell that begins with
 * `=`, `+`, `-`, `@`, tab or CR as a formula — including `=HYPERLINK(...)` and,
 * historically, `=cmd|'/c calc'!A1`. A travel purpose reading
 * `=1+1` is harmless; one crafted by whoever filled the form is not, and this
 * export is opened by Finance on a machine with access to more than this app.
 *
 * Prefixing with an apostrophe is the fix every spreadsheet honours: the cell
 * still reads correctly to a human, and nothing is evaluated.
 */

const DANGEROUS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  if (text.length > 0 && DANGEROUS.has(text[0])) text = `'${text}`;

  // Quote whenever the delimiter, a quote or a newline is present; doubling the
  // internal quotes is what RFC 4180 asks for.
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;

  return text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  // CRLF: Excel on Windows is the primary consumer and it is the RFC default.
  return `${lines.join('\r\n')}\r\n`;
}
