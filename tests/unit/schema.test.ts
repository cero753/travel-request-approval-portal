import { describe, expect, it } from 'vitest';
import { travelRequestSchema, draftSchema, sumExpenses } from '@/features/requests/schema';

/**
 * PRD AC 1 — "a request cannot be submitted with required fields missing".
 *
 * This schema is the server action's authority, not just the form's, so these
 * tests exercise it the way a hand-rolled POST would: by handing it objects the
 * UI would never produce.
 */

/** A request that should always pass, so each test can break exactly one thing. */
function valid(overrides: Record<string, unknown> = {}) {
  return {
    fromCity: 'Bengaluru',
    toCity: 'Mumbai',
    departureDate: '2026-10-01',
    returnDate: '2026-10-04',
    mode: 'FLIGHT',
    purpose: 'Client kickoff workshop with the ops team.',
    bookingLinks: [{ url: 'https://www.example.com/flight/123' }],
    expenses: [{ category: 'TICKET', amount: 8400 }],
    currency: 'INR',
    billTo: 'AWIGN',
    projectCode: '',
    managerEmail: 'manager@awign.example',
    ...overrides,
  };
}

/** Collects the field paths a failed parse complained about. */
function errorPaths(input: unknown): string[] {
  const result = travelRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join('.'));
}

describe('the baseline fixture', () => {
  it('parses, so every failure below is caused by its own change', () => {
    expect(travelRequestSchema.safeParse(valid()).success).toBe(true);
  });
});

describe('AC 1 — required fields', () => {
  it.each([
    ['fromCity', { fromCity: '' }],
    ['toCity', { toCity: '' }],
    ['departureDate', { departureDate: '' }],
    ['mode', { mode: '' }],
    ['purpose', { purpose: '' }],
    ['managerEmail', { managerEmail: '' }],
  ])('rejects a submission missing %s', (field, override) => {
    expect(errorPaths(valid(override))).toContain(field);
  });

  it('rejects a request with no booking link', () => {
    expect(errorPaths(valid({ bookingLinks: [] }))).toContain('bookingLinks');
  });

  it('rejects a request with no estimated costs', () => {
    expect(errorPaths(valid({ expenses: [] }))).toContain('expenses');
  });

  it('rejects a purpose too short to audit', () => {
    // "trip" tells Finance nothing; the minimum forces a real sentence.
    expect(errorPaths(valid({ purpose: 'trip' }))).toContain('purpose');
  });

  it('rejects a malformed manager email', () => {
    expect(errorPaths(valid({ managerEmail: 'not-an-email' }))).toContain('managerEmail');
  });

  it('normalises the manager email to lowercase', () => {
    // The address is compared against an inbound reply's sender, so casing
    // must not decide whether an approval is accepted.
    const parsed = travelRequestSchema.parse(valid({ managerEmail: '  Manager@Awign.Example  ' }));
    expect(parsed.managerEmail).toBe('manager@awign.example');
  });
});

describe('AC 2 — bill-to Project requires a Project ID', () => {
  it('rejects PROJECT with no project code', () => {
    expect(errorPaths(valid({ billTo: 'PROJECT', projectCode: '' }))).toContain('projectCode');
  });

  it('rejects PROJECT with a whitespace-only project code', () => {
    // The most likely way to defeat a naive presence check.
    expect(errorPaths(valid({ billTo: 'PROJECT', projectCode: '   ' }))).toContain('projectCode');
  });

  it('accepts PROJECT with a real project code', () => {
    expect(travelRequestSchema.safeParse(valid({ billTo: 'PROJECT', projectCode: 'PRJ-101' })).success).toBe(true);
  });

  it('rejects AWIGN carrying a stale project code', () => {
    // Otherwise switching bill-to back to Awign silently bills a project.
    expect(errorPaths(valid({ billTo: 'AWIGN', projectCode: 'PRJ-101' }))).toContain('projectCode');
  });
});

describe('booking link scheme check', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ])('rejects %s', (url) => {
    // These are rendered as anchors inside an approval email.
    expect(errorPaths(valid({ bookingLinks: [{ url }] }))).toContain('bookingLinks.0.url');
  });

  it.each(['http://example.com/x', 'https://www.makemytrip.com/flight/abc?x=1'])(
    'accepts %s',
    (url) => {
      expect(travelRequestSchema.safeParse(valid({ bookingLinks: [{ url }] })).success).toBe(true);
    },
  );
});

describe('date and route coherence', () => {
  it('rejects a return date before departure', () => {
    expect(errorPaths(valid({ departureDate: '2026-10-04', returnDate: '2026-10-01' }))).toContain('returnDate');
  });

  it('accepts a same-day return', () => {
    expect(travelRequestSchema.safeParse(valid({ departureDate: '2026-10-01', returnDate: '2026-10-01' })).success).toBe(true);
  });

  it('accepts a one-way trip with no return date', () => {
    expect(travelRequestSchema.safeParse(valid({ returnDate: '' })).success).toBe(true);
  });

  it('rejects travel from a city to itself, ignoring case and padding', () => {
    expect(errorPaths(valid({ fromCity: 'Mumbai', toCity: '  mumbai ' }))).toContain('toCity');
  });

  it('rejects a non-ISO date', () => {
    expect(errorPaths(valid({ departureDate: '01/10/2026' }))).toContain('departureDate');
  });
});

describe('expense amounts', () => {
  it('rejects a negative amount', () => {
    // A negative line would reduce the total and under-state the approval.
    expect(errorPaths(valid({ expenses: [{ category: 'TICKET', amount: -100 }] }))).toContain('expenses.0.amount');
  });

  it('rejects an implausibly large amount', () => {
    expect(errorPaths(valid({ expenses: [{ category: 'TICKET', amount: 1e12 }] }))).toContain('expenses.0.amount');
  });

  it('rejects an unknown category', () => {
    expect(errorPaths(valid({ expenses: [{ category: 'BRIBES', amount: 10 }] }))).toContain('expenses.0.category');
  });

  it('coerces a numeric string, because form inputs are strings', () => {
    const parsed = travelRequestSchema.parse(valid({ expenses: [{ category: 'MEALS', amount: '450' }] }));
    expect(parsed.expenses[0].amount).toBe(450);
  });
});

describe('sumExpenses — must agree with the database trigger', () => {
  it('sums numbers and numeric strings alike', () => {
    expect(sumExpenses([{ amount: 100 }, { amount: '250.50' }, { amount: 0 }])).toBe(350.5);
  });

  it('treats an unparseable amount as zero rather than NaN', () => {
    // A NaN total would render as "NaN" in the approval email.
    expect(sumExpenses([{ amount: 100 }, { amount: 'abc' }])).toBe(100);
  });

  it('is zero for no rows', () => {
    expect(sumExpenses([])).toBe(0);
  });
});

describe('draftSchema — incomplete is the point of a draft', () => {
  it('accepts an entirely empty draft', () => {
    expect(draftSchema.safeParse({}).success).toBe(true);
  });

  it('still rejects a javascript: booking link in a draft', () => {
    // A draft is saved, but it must not be able to store a hostile link that
    // a later submit path might trust.
    expect(draftSchema.safeParse({ bookingLinks: [{ url: 'javascript:alert(1)' }] }).success).toBe(false);
  });

  it('defaults currency to INR', () => {
    expect(draftSchema.parse({}).currency).toBe('INR');
  });
});
