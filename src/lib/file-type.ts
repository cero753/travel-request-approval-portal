/**
 * Magic-byte sniffing for the small set of formats attachments may use.
 *
 * The browser's `File.type` is taken verbatim from the file extension on most
 * platforms, so a `payload.exe` renamed `invoice.pdf` arrives claiming
 * `application/pdf`. Storage would happily keep it and hand it back with that
 * content type, which is how a "receipts" bucket becomes a malware host.
 * Deciding from the bytes is the only check that means anything.
 *
 * Deliberately a fixed allow-list, not a library: five formats, no dependency,
 * no parser surface of its own.
 */

export type SniffedType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/heic';

export const ALLOWED_MIME: readonly SniffedType[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'];

/** Returns the real type, or null when the bytes match nothing we accept. */
export function sniffMimeType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, PDF)) return 'application/pdf';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';

  // RIFF containers: bytes 0-3 'RIFF', 8-11 name the payload. Checking only
  // 'RIFF' would also admit .wav and .avi.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';

  // ISO-BMFF: bytes 4-7 'ftyp', then a brand. HEIC shares this container with
  // MP4, so the brand is what distinguishes a photo from a video file.
  if (ascii(bytes, 4, 4) === 'ftyp' && HEIC_BRANDS.includes(ascii(bytes, 8, 4))) {
    return 'image/heic';
  }

  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  let out = '';
  for (let i = offset; i < offset + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * A filename safe to show in HTML and to put in a Content-Disposition header.
 * Path separators and control characters are the two that actually bite, and a
 * bare double quote is what would end the `filename="..."` parameter early.
 *
 * Written as a codepoint filter rather than a regex so the control-character
 * range is stated in numbers instead of literal bytes in the source.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';

  let out = '';
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // C0 controls and DEL
    if (char === '"') continue;
    out += char;
  }

  return out.trim().slice(0, 200) || 'file';
}
