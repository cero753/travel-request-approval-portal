# Travel Request & Approval Portal

Internal tooling for Awign Finance. An employee submits a work-travel request;
their manager approves or rejects it **by replying to an email** — no login, no
clicks. The reply is parsed by an inbound-email webhook and the decision flows
back into the portal automatically, with a complete audit trail.

---

## Status

| Milestone | State |
|---|---|
| M1 — request capture, drafts, dashboards, attachments | Built |
| M2 — outbound email, inbound webhook, reply parsing, decisions | Built |
| M3 — one-click approve/reject links, in-portal approver queue | Built |
| M4 — finance view, filters, CSV export, project admin | Built |
| M5 — reminder and expiry jobs | Built |

**Verified:** 133 unit tests green (40 reply-parser fixtures, schema and bill-to
rules, CSV formula-injection, upload magic-byte sniffing), `tsc --noEmit` clean,
production build clean, secret scan clean, all 12 migrations applied.

**Not yet verified:** the integration suite in `tests/integration/` has never
been executed — it needs `SUPABASE_SERVICE_ROLE_KEY`, which was not available at
build time. Treat those tests as unproven until they go green.

Not deployed. Local only.

---

## First run

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Three values must be supplied by hand:

1. **`SUPABASE_SERVICE_ROLE_KEY`** — Supabase Dashboard → Project Settings →
   API Keys → `service_role` (labelled "secret"). This key bypasses RLS. It is
   read only by the webhook, cron, seed and storage paths, and never reaches the
   browser; `npm run check:secrets` fails if it ever lands in a `NEXT_PUBLIC_*`
   name.
2. **`TOKEN_PEPPER`** and **`CRON_SECRET`** — generate each with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

Then:

```bash
npm run seed     # 6 demo users, one per role, plus sample projects
npm run dev
```

### Trying the approval flow without a mail server

`EMAIL_PROVIDER=fake` writes every outbound message to `dev_sent_emails` instead
of sending it, and `/dev/mailbox` renders them.

Submit a request, open **`/dev/mailbox`**, and click **Reply as manager →
Approved**. The dashboard flips to Approved with a full audit trail.

This is not a shortcut through the flow. The simulator builds a metadata-only
`email.received` payload, signs it with real Svix, and POSTs it over real HTTP
to the real webhook — so the signature check, the deduplication, the mandatory
second body fetch, the parser and `decide_request` all run exactly as they will
in production. Only the two Resend network calls are substituted.

The mailbox exposes the awkward cases deliberately: HTML-only replies,
bottom-posting, auto-replies, duplicate delivery, a wrong sender, a missing
plus-address, and "fail the body fetch N times" to exercise the retry queue.
A separate panel backdates a request and runs the reminder/expiry jobs, so
seven-day behaviour is testable in seconds.

`/dev/mailbox` can approve company spend without a manager. It is gated on
`ENABLE_DEV_TOOLS=true` **and** a non-production build, enforced in `proxy.ts`
and again inside every dev server action.

---

## Switching on real email (when the Resend key arrives)

No code changes — four config steps:

1. Verify a sending domain. Put the MX record on a dedicated subdomain
   (e.g. `mail.awign.com`) at the **lowest priority**, so existing company mail
   is not disturbed.
2. Register the `email.received` webhook; copy the `whsec_...` signing secret
   into `EMAIL_WEBHOOK_SECRET`.
3. Check whether catch-all `approvals+<key>@` actually reaches the webhook. If it
   does not, nothing breaks — the matcher has three more strategies.
4. Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`. For the first smoke test set
   `EMAIL_REDIRECT_TO=you@example.com`; an unverified domain can only send to the
   account owner.

---

## How a reply is matched back to a request

Plus-addressing is not guaranteed to survive every mail path, so
`src/lib/email/match-request.ts` tries four strategies in order:

1. **Plus-address** — `approvals+<reply_key>@` parsed from `received_for`/`to`
2. **Body ref token** — every outbound mail carries a `Ref: TRQ-<reply_key>`
   footer, and the quoted original comes back in most replies
3. **`In-Reply-To` / `References`** matched against the stored outbound Message-ID
4. **Subject + sender** — only when exactly one pending request exists for that
   manager; otherwise the message is abandoned rather than guessed

`reply_key` is a random 16-character value, not the request id, so it cannot be
guessed.

A reply may only change a decision if the sender matches `manager_email` **and**
the message passes DMARC (or SPF+DKIM). A manager who forwards to an assistant
is refused — the correct trade for a spend control. The portal and the fallback
links cover that case.

---

## Safety properties worth knowing before changing anything

- **`GET /approve` and `GET /reject` do nothing.** Outlook Safe Links, corporate
  scanners and Gmail prefetch all fetch links found in mail. A mutating GET would
  auto-approve every request the moment the manager's mail server scanned it. The
  decision happens on POST.
- **Every state transition is a Postgres function**, not application code.
  `decide_request` does a conditional `UPDATE ... WHERE status='PENDING_APPROVAL'
  ... RETURNING` and reports whether it applied. A reply and a link click racing
  each other produce exactly one decision; the loser writes an audit row. Expiry
  works the same way.
- **Approval tokens are single-use in the database** (`UPDATE ... WHERE used_at IS
  NULL ... RETURNING`), stored only as `sha256(token + TOKEN_PEPPER)`. The token
  itself never touches the database, and token expiry is pinned equal to the
  request's, so a token cannot outlive what it approves.
- **Duplicate webhooks are a no-op insert**, enforced by a unique index on the
  Svix id.
- **RLS is on for every table**, and the state-machine functions are granted to
  `service_role` only — `anon` and `authenticated` cannot call `decide_request`
  at all.
- **Uploads are sniffed by magic bytes.** A `.exe` renamed `invoice.pdf` is
  rejected; storage keys are UUIDs and download URLs are signed for 60 seconds.
- **CSV cells beginning `=`, `+`, `-`, `@`, tab or CR are prefixed** so Finance's
  spreadsheet does not evaluate a travel purpose as a formula.

---

## Commands

```bash
npm run dev              # local dev server
npm run build            # production build
npm run typecheck        # next typegen && tsc --noEmit
npm run lint
npm test                 # everything
npm run test:unit        # no database required
npm run test:integration # needs SUPABASE_SERVICE_ROLE_KEY and a dev server
npm run seed
npm run check:secrets    # run before every push
```

## Layout

```
src/app/             routes: requests, approvals, finance, admin, api, dev
src/features/        feature slices: requests, decisions, notifications, admin, dev
src/lib/email/       provider interface, reply parser, matcher, fake provider
src/lib/             env, supabase clients, tokens, csv, file-type, cities
src/emails/          React Email templates
supabase/migrations/ 0001-0012, applied in order
tests/unit/          no database needed
tests/integration/   real dev server, real HTTP, real database
scripts/             seed.ts, check-secrets.ts
```
