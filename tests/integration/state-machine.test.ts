// See scripts/seed.ts: secrets live in .env.local, which `dotenv/config` skips.
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type { Database } from '@/lib/supabase/database.types';

/**
 * The state machine, against the real database.
 *
 * PRD AC 6 and AC 9, plus the concurrency guarantees the whole design rests on.
 * These run against Postgres directly through the service client rather than
 * over HTTP, because the transitions live in SQL: `decide_request` and
 * `consume_approval_token` are where a double approval would actually happen,
 * and testing them through three layers of app code would only make a failure
 * harder to locate.
 *
 * The expected values here were first confirmed by running the same sequence
 * inside a rolled-back DO block against this project.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. Without it the suite skips loudly rather
 * than failing, so `npm test` stays green before the key is pasted in.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && serviceKey);

if (!ready) {
  console.warn(
    '\n  tests/integration/state-machine: SKIPPED — set SUPABASE_SERVICE_ROLE_KEY in .env.local.\n',
  );
}

const MANAGER = 'itest.manager@awign.test';

/** Everything this suite creates is tagged so cleanup can find it. */
const TAG = `itest-${randomUUID().slice(0, 8)}`;

/**
 * Unwraps a nullable postgrest result. Failing here — rather than at a later
 * `expect` on `undefined` — names which call returned nothing.
 */
function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`expected ${what}, got ${String(value)}`);
  return value;
}

describe.runIf(ready)('state machine', () => {
  let admin: SupabaseClient<Database>;
  let userId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin.auth.admin.createUser({
      email: `${TAG}@awign.test`,
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
      user_metadata: { full_name: 'Integration Test', role: 'REQUESTER', manager_email: MANAGER },
    });
    if (error) throw error;
    userId = data.user.id;

    // The handle_new_user trigger creates the profile; make the role explicit
    // so a change to that trigger cannot silently alter what is under test.
    const { error: pErr } = await admin
      .from('profiles')
      .upsert({ id: userId, email: `${TAG}@awign.test`, full_name: 'Integration Test', role: 'REQUESTER', manager_email: MANAGER });
    if (pErr) throw pErr;
  });

  afterAll(async () => {
    // travel_requests cascade from the profile, which cascades from the user.
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  /** Creates a request and submits it. Returns its id. */
  async function submittedRequest(overrides: Record<string, unknown> = {}): Promise<string> {
    const departure = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

    const { data: req, error } = await admin
      .from('travel_requests')
      .insert({
        requester_id: userId,
        from_city: 'Bengaluru',
        to_city: 'Mumbai',
        departure_date: departure,
        mode: 'FLIGHT',
        purpose: 'Integration test of the state machine.',
        currency: 'INR',
        bill_to: 'AWIGN',
        manager_email: MANAGER,
        status: 'DRAFT',
        ...overrides,
      })
      .select('id')
      .single();
    if (error) throw error;

    await admin.from('expense_items').insert({ request_id: req.id, category: 'TICKET', amount: 8400 });
    await admin.from('booking_links').insert({ request_id: req.id, url: 'https://example.com/f/1' });

    const { data: submitted, error: sErr } = await admin
      .rpc('submit_request', { p_request_id: req.id, p_actor_email: `${TAG}@awign.test`, p_expiry_days: 7 })
      .single();
    if (sErr) throw sErr;
    expect(must(submitted, 'submit_request result').ok).toBe(true);

    return req.id;
  }

  async function auditEvents(requestId: string): Promise<string[]> {
    const { data } = await admin
      .from('audit_log')
      .select('event')
      .eq('request_id', requestId)
      .order('id', { ascending: true });
    return (data ?? []).map((r) => r.event);
  }

  function decide(
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    channel: Database['public']['Enums']['decision_channel'],
    reason?: string,
  ) {
    return admin
      .rpc('decide_request', {
        p_request_id: requestId,
        p_decision: decision,
        p_channel: channel,
        p_actor_email: MANAGER,
        p_reason: reason ?? undefined,
      })
      .single();
  }

  describe('decide_request', () => {
    it('applies the first decision and refuses the second', async () => {
      const id = await submittedRequest();

      const first = must((await decide(id, 'APPROVED', 'EMAIL_REPLY')).data, 'first decision');
      expect(first.applied).toBe(true);
      expect(first.final_status).toBe('APPROVED');

      // The manager replied and then clicked the link. The second must lose.
      const second = must((await decide(id, 'REJECTED', 'LINK', 'too costly')).data, 'second decision');
      expect(second.applied).toBe(false);
      expect(second.error_code).toBe('not_pending');
      expect(second.final_status).toBe('APPROVED'); // unchanged
    });

    it('records the losing decision instead of discarding it', async () => {
      const id = await submittedRequest();
      await decide(id, 'APPROVED', 'EMAIL_REPLY');
      await decide(id, 'REJECTED', 'LINK', 'too costly');

      // AC 9: an audit trail that drops what it rejects is not an audit trail.
      expect(await auditEvents(id)).toEqual([
        'request.submitted',
        'request.approved',
        'decision.ignored_not_pending',
      ]);
    });

    it('lets exactly one of two concurrent decisions win', async () => {
      const id = await submittedRequest();

      // The race the whole design exists to survive: a reply and a link click
      // landing in the same instant.
      const [a, b] = await Promise.all([
        decide(id, 'APPROVED', 'EMAIL_REPLY'),
        decide(id, 'REJECTED', 'LINK', 'too costly'),
      ]);

      const applied = [a.data, b.data].filter((r) => r?.applied);
      expect(applied).toHaveLength(1);

      const row = must(
        (await admin.from('travel_requests').select('status').eq('id', id).single()).data,
        'request row',
      );
      expect(row.status).toBe(applied[0]!.final_status);
    });

    it('recalculates the total from the expense rows', async () => {
      const id = await submittedRequest();
      const row = must(
        (await admin.from('travel_requests').select('total_amount').eq('id', id).single()).data,
        'request row',
      );
      expect(Number(row.total_amount)).toBe(8400);
    });
  });

  describe('consume_approval_token — PRD AC 6', () => {
    /** Mirrors hashToken() without importing it: that module is server-only. */
    function hash(token: string): string {
      return createHash('sha256').update(token + (process.env.TOKEN_PEPPER ?? '')).digest('hex');
    }

    async function issue(requestId: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') {
      const token = randomUUID();
      const { error } = await admin.from('approval_tokens').insert({
        request_id: requestId,
        action,
        token_hash: hash(token),
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      if (error) throw error;
      return token;
    }

    it('accepts a token once and refuses it thereafter', async () => {
      const id = await submittedRequest();
      const token = await issue(id);

      const first = must(
        (
          await admin
            .rpc('consume_approval_token', { p_token_hash: hash(token), p_ip: '203.0.113.9' })
            .single()
        ).data,
        'first token use',
      );
      expect(first.ok).toBe(true);
      expect(first.action).toBe('APPROVE');
      expect(first.request_id).toBe(id);

      // Single use is enforced by the UPDATE ... WHERE used_at IS NULL, not by
      // a read-then-write, so replaying it cannot win a race either.
      const second = must(
        (
          await admin
            .rpc('consume_approval_token', { p_token_hash: hash(token), p_ip: '203.0.113.9' })
            .single()
        ).data,
        'second token use',
      );
      expect(second.ok).toBe(false);
      expect(second.error_code).toBe('already_used');
    });

    it('refuses a token that was never issued', async () => {
      const result = must(
        (
          await admin
            .rpc('consume_approval_token', { p_token_hash: hash('never-issued'), p_ip: null })
            .single()
        ).data,
        'unknown token result',
      );
      expect(result.ok).toBe(false);
      expect(result.error_code).toBe('invalid');
    });

    it('lets only one of two concurrent uses through', async () => {
      const id = await submittedRequest();
      const token = await issue(id);

      const [a, b] = await Promise.all([
        admin.rpc('consume_approval_token', { p_token_hash: hash(token), p_ip: null }).single(),
        admin.rpc('consume_approval_token', { p_token_hash: hash(token), p_ip: null }).single(),
      ]);

      expect([a.data, b.data].filter((r) => r?.ok)).toHaveLength(1);
    });
  });

  describe('expire_due_requests — PRD 4.6', () => {
    it('ignores a request that is not yet due, then claims it once due', async () => {
      const id = await submittedRequest();

      const { data: before } = await admin.rpc('expire_due_requests', { p_limit: 100 });
      expect(before ?? []).not.toContain(id);

      await admin
        .from('travel_requests')
        .update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() })
        .eq('id', id);

      const { data: after } = await admin.rpc('expire_due_requests', { p_limit: 100 });
      expect(after ?? []).toContain(id);

      const row = must(
        (await admin.from('travel_requests').select('status').eq('id', id).single()).data,
        'request row',
      );
      expect(row.status).toBe('EXPIRED');
    });

    it('refuses a decision that arrives after expiry', async () => {
      const id = await submittedRequest();
      await admin
        .from('travel_requests')
        .update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() })
        .eq('id', id);
      await admin.rpc('expire_due_requests', { p_limit: 100 });

      // A reply in flight when the job ran must not resurrect the request.
      const late = must((await decide(id, 'APPROVED', 'EMAIL_REPLY')).data, 'late decision');
      expect(late.applied).toBe(false);
      expect(late.error_code).toBe('not_pending');

      expect(await auditEvents(id)).toEqual([
        'request.submitted',
        'request.expired',
        'decision.ignored_not_pending',
      ]);
    });
  });
});
