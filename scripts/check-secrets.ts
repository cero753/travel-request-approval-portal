/**
 * Pre-push secret scan.
 *
 * Three distinct failure modes, because they fail in three different ways:
 *
 *  1. A real secret is tracked by git. Once pushed it is public forever, even
 *     if the next commit deletes it — the blob stays in history.
 *  2. A secret is assigned to a NEXT_PUBLIC_* name. Next.js inlines those into
 *     the client bundle at build time, so it ships to every browser. This one
 *     leaks without any git mistake at all.
 *  3. A long-lived credential is hardcoded in source rather than read from env.
 *
 * Exits non-zero on any finding. Run before pushing:  npm run check:secrets
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

interface Finding {
  rule: string;
  file: string;
  line?: number;
  detail: string;
}

const findings: Finding[] = [];

function report(rule: string, file: string, detail: string, line?: number) {
  findings.push({ rule, file, detail, line });
}

/** Files git is tracking. Untracked files cannot leak via push. */
function trackedFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    console.error('check-secrets: not a git repository — skipping tracked-file rules.');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rule 1 — no env file may be tracked, except the template.
// ---------------------------------------------------------------------------

const ENV_ALLOWED = new Set(['.env.example']);

function checkTrackedEnvFiles(files: string[]) {
  for (const file of files) {
    const base = path.basename(file);
    if (!base.startsWith('.env')) continue;
    if (ENV_ALLOWED.has(base)) continue;
    report('tracked-env-file', file, `${base} is tracked by git. Untrack it: git rm --cached "${file}"`);
  }
}

/**
 * The template is committed, so it must never hold a filled-in value. A key
 * left in .env.example is the most common way this class of file leaks.
 */
function checkEnvExampleIsEmpty() {
  const file = '.env.example';
  const abs = path.join(ROOT, file);
  if (!existsSync(abs)) return;

  for (const [i, raw] of readFileSync(abs, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!value) continue;

    // Placeholders and non-secret config are fine; a real-looking value is not.
    if (looksLikeSecret(name, value)) {
      report('value-in-env-example', file, `${name} appears to hold a real value`, i + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2 — nothing secret may wear a NEXT_PUBLIC_ name.
//
// Checked in every env file on disk, tracked or not: this leak happens at
// build time, so an untracked .env.local is just as dangerous.
// ---------------------------------------------------------------------------

/** Names that are safe to expose even though they match the patterns below. */
const PUBLIC_SAFE = new Set([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', // the publishable key is public by design
  'NEXT_PUBLIC_APP_URL',
]);

const SECRET_NAME = /(SERVICE_ROLE|SECRET|PEPPER|PRIVATE|PASSWORD|_TOKEN$|API_KEY)/i;

function checkPublicEnvNames() {
  for (const file of ['.env.example', '.env.local', '.env', '.env.development', '.env.production']) {
    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) continue;

    for (const [i, raw] of readFileSync(abs, 'utf8').split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!name.startsWith('NEXT_PUBLIC_') || PUBLIC_SAFE.has(name)) continue;

      if (SECRET_NAME.test(name)) {
        report('secret-named-public', file, `${name} is exposed to the browser by its NEXT_PUBLIC_ prefix`, i + 1);
      } else if (isServiceRoleKey(value)) {
        report('service-key-named-public', file, `${name} holds a service-role key and is exposed to the browser`, i + 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 3 — no hardcoded credential in tracked source.
// ---------------------------------------------------------------------------

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.sql', '.md', '.yml', '.yaml']);

/** Each pattern is anchored on a vendor prefix, so it matches keys, not prose. */
const CREDENTIAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}/ },
  { name: 'Svix signing secret', re: /\bwhsec_[A-Za-z0-9+/=_-]{20,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

/**
 * A service-role JWT. Supabase's legacy keys are JWTs whose payload contains
 * "service_role"; decoding is more reliable than matching the opaque body.
 */
function isServiceRoleKey(value: string): boolean {
  if (/\bsb_secret_[A-Za-z0-9_-]{20,}/.test(value)) return true;

  const parts = value.split('.');
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

function checkSourceForCredentials(files: string[]) {
  for (const file of files) {
    if (!SOURCE_EXT.has(path.extname(file))) continue;
    // This file necessarily contains the patterns it searches for.
    if (file === 'scripts/check-secrets.ts') continue;

    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) continue;

    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      for (const { name, re } of CREDENTIAL_PATTERNS) {
        if (re.test(line)) report('hardcoded-credential', file, `looks like a ${name}`, i + 1);
      }
      if (isServiceRoleKey(line.trim())) {
        report('hardcoded-credential', file, 'looks like a service-role JWT', i + 1);
      }
    }
  }
}

/**
 * Distinguishes a filled-in value from a placeholder. Deliberately loose: a
 * false positive costs one line of review, a false negative costs a rotation.
 */
function looksLikeSecret(name: string, value: string): boolean {
  if (/^(your-|<|\.\.\.|xxx|todo|changeme|placeholder)/i.test(value)) return false;
  if (value.endsWith('...')) return false;
  if (!SECRET_NAME.test(name)) return false;
  return value.length >= 16;
}

// ---------------------------------------------------------------------------

const files = trackedFiles();
checkTrackedEnvFiles(files);
checkEnvExampleIsEmpty();
checkPublicEnvNames();
checkSourceForCredentials(files);

if (findings.length === 0) {
  console.log(`check-secrets: clean (${files.length} tracked files scanned).`);
  process.exit(0);
}

console.error(`\ncheck-secrets: ${findings.length} finding(s)\n`);
for (const f of findings) {
  console.error(`  [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ''}\n      ${f.detail}`);
}
console.error('\nNothing should be pushed until these are resolved.\n');
process.exit(1);
