import { describe, expect, it } from 'vitest';
import { sniffMimeType, safeFileName, ALLOWED_MIME, MAX_UPLOAD_BYTES } from '@/lib/file-type';

/**
 * Attachment validation.
 *
 * The threat is narrow and specific: `File.type` comes from the extension, so
 * a renamed executable arrives claiming to be a PDF. Storage would keep it and
 * serve it back with that content type. These tests describe what the byte
 * check must catch when the declared type is a lie.
 *
 * No control character is written as a literal anywhere in this file — they are
 * built with `String.fromCharCode` and numeric byte arrays instead. Literal
 * control bytes in source are invisible in review and survive a careless edit.
 */

const CR = String.fromCharCode(0x0d);
const LF = String.fromCharCode(0x0a);
const NUL = String.fromCharCode(0x00);
const BEL = String.fromCharCode(0x07);
const DEL = String.fromCharCode(0x7f);

/** Builds a buffer with `head` at the front, zero-padded to `totalLength`. */
function bytes(head: number[], totalLength = 64): Uint8Array {
  const out = new Uint8Array(totalLength);
  out.set(head.slice(0, totalLength));
  return out;
}

function fromAscii(text: string, totalLength = 64): Uint8Array {
  return bytes([...text].map((c) => c.charCodeAt(0)), totalLength);
}

/** Places an ASCII tag at a byte offset, the way a container header does. */
function withTag(buf: Uint8Array, offset: number, tag: string): Uint8Array {
  buf.set([...tag].map((c) => c.charCodeAt(0)), offset);
  return buf;
}

describe('sniffMimeType — accepts the real thing', () => {
  it('detects a PDF by %PDF', () => {
    expect(sniffMimeType(fromAscii('%PDF-1.7'))).toBe('application/pdf');
  });

  it('detects a PNG by its 8-byte signature', () => {
    expect(sniffMimeType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('detects a JPEG', () => {
    expect(sniffMimeType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detects a WebP by RIFF + WEBP, not RIFF alone', () => {
    const webp = withTag(withTag(new Uint8Array(64), 0, 'RIFF'), 8, 'WEBP');
    expect(sniffMimeType(webp)).toBe('image/webp');
  });

  it.each(['heic', 'heix', 'mif1'])('detects an ISO-BMFF file with brand %s as HEIC', (brand) => {
    const heic = withTag(withTag(new Uint8Array(64), 4, 'ftyp'), 8, brand);
    expect(sniffMimeType(heic)).toBe('image/heic');
  });
});

describe('sniffMimeType — rejects the impostors', () => {
  it('rejects a Windows PE renamed invoice.pdf', () => {
    // "MZ" — the entire reason this module exists.
    expect(sniffMimeType(bytes([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull();
  });

  it('rejects an ELF binary', () => {
    expect(sniffMimeType(bytes([0x7f, 0x45, 0x4c, 0x46]))).toBeNull();
  });

  it('rejects a ZIP, and therefore a .docx or a renamed archive', () => {
    expect(sniffMimeType(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
  });

  it('rejects HTML, which Storage could otherwise serve as a stored-XSS page', () => {
    expect(sniffMimeType(fromAscii('<!DOCTYPE html><script>'))).toBeNull();
  });

  it('rejects a shell script', () => {
    expect(sniffMimeType(fromAscii('#!/bin/sh'))).toBeNull();
  });

  it('rejects a RIFF container that is not WebP, such as a .wav', () => {
    const wav = withTag(withTag(new Uint8Array(64), 0, 'RIFF'), 8, 'WAVE');
    expect(sniffMimeType(wav)).toBeNull();
  });

  it('rejects an MP4, which shares the ftyp container with HEIC', () => {
    const mp4 = withTag(withTag(new Uint8Array(64), 4, 'ftyp'), 8, 'isom');
    expect(sniffMimeType(mp4)).toBeNull();
  });

  it('rejects a polyglot where the PDF signature is present but not leading', () => {
    expect(sniffMimeType(fromAscii('GIF89a%PDF-1.7'))).toBeNull();
  });

  it('rejects empty and truncated input without throwing', () => {
    expect(sniffMimeType(new Uint8Array(0))).toBeNull();
    expect(sniffMimeType(new Uint8Array([0x89, 0x50]))).toBeNull(); // half a PNG header
    expect(sniffMimeType(fromAscii('RIFF', 6))).toBeNull(); // ends before the payload tag
  });
});

describe('the allow-list itself', () => {
  it('contains only the five documented formats', () => {
    // A silent addition here widens what Storage will accept and serve.
    expect([...ALLOWED_MIME].sort()).toEqual([
      'application/pdf',
      'image/heic',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('every sniffable type is on the allow-list', () => {
    const png = sniffMimeType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(ALLOWED_MIME).toContain(png);
  });

  it('caps uploads at 10 MiB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('safeFileName', () => {
  it('strips POSIX and Windows path components', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\karti\\secrets.pdf')).toBe('secrets.pdf');
  });

  it('removes the double quote that would end a Content-Disposition parameter', () => {
    expect(safeFileName('in"voice.pdf')).toBe('invoice.pdf');
  });

  it('removes CR and LF, which would otherwise inject a response header', () => {
    expect(safeFileName('bad' + CR + LF + 'X-Injected: yes.pdf')).toBe('badX-Injected: yes.pdf');
  });

  it('removes NUL, which truncates the name in C-based storage layers', () => {
    expect(safeFileName('invoice' + NUL + '.exe')).toBe('invoice.exe');
  });

  it.each([
    ['BEL', BEL],
    ['DEL', DEL],
  ])('removes %s', (_label, char) => {
    expect(safeFileName('a' + char + 'b.pdf')).toBe('ab.pdf');
  });

  it('never returns an empty string', () => {
    // The fallback matters: an empty name would produce a broken header.
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('   ')).toBe('file');
    expect(safeFileName('///')).toBe('file');
    expect(safeFileName(NUL + DEL)).toBe('file');
  });

  it('caps the length', () => {
    expect(safeFileName('a'.repeat(500) + '.pdf')).toHaveLength(200);
  });

  it('preserves ordinary and non-ASCII names', () => {
    expect(safeFileName('Flight receipt (Oct).pdf')).toBe('Flight receipt (Oct).pdf');
    expect(safeFileName('रसीद.pdf')).toBe('रसीद.pdf');
  });
});
