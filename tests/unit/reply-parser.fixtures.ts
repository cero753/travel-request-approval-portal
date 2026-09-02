import type { ParseInput, Verdict } from '@/lib/email/reply-parser';

export interface Fixture {
  n: number;
  name: string;
  input: ParseInput;
  expect: Verdict;
  /** Substring the extracted reason must contain, if the test asserts one. */
  reasonContains?: string;
  /** Asserted only when explicitly set. */
  isAutoReply?: boolean;
  /** Why this case exists. Shown on failure. */
  why?: string;
}

/** The exact instruction block our outbound email contains. */
const OUR_INSTRUCTION =
  'To approve, simply reply to this email with Approved or Yes. To reject, reply with Rejected or No (you may add a reason).';

const QUOTED_ORIGINAL = [
  '',
  'On Mon, 1 Sep 2026 at 18:04, Awign Travel <approvals@awign.example> wrote:',
  '',
  '> Travel approval needed: Kartik Bhardwaj - Bengaluru -> Mumbai (05 Sep 2026)',
  '>',
  `> ${OUR_INSTRUCTION}`,
  '>',
  '> Total estimated cost: INR 10,000.50',
  '> Ref: TRQ-a1b2c3d4e5f6a7b8c9d0',
].join('\n');

export const FIXTURES: Fixture[] = [
  // --- plain approvals -----------------------------------------------------
  { n: 1, name: 'bare Approved with full stop', input: { text: 'Approved.' }, expect: 'approve' },
  { n: 2, name: 'lowercase approved', input: { text: 'approved' }, expect: 'approve' },
  { n: 3, name: 'yes, go ahead', input: { text: 'Yes, go ahead' }, expect: 'approve' },
  { n: 4, name: 'OK on its own', input: { text: 'ok' }, expect: 'approve' },
  { n: 5, name: 'LGTM', input: { text: 'LGTM' }, expect: 'approve' },
  {
    n: 6,
    name: 'approval with a reason',
    input: { text: 'Approved. Client meeting is critical this quarter.' },
    expect: 'approve',
    reasonContains: 'Client meeting is critical',
  },
  {
    n: 7,
    name: 'salutation then approval on a later line',
    input: { text: 'Hi Kartik,\n\nApproved.\n' },
    expect: 'approve',
  },
  {
    n: 8,
    name: 'no objection (contains the word "no" but is an approval)',
    input: { text: 'No objection from my side.' },
    expect: 'approve',
    why: 'the naive "no" -> reject rule must not fire here',
  },

  // --- plain rejections ----------------------------------------------------
  { n: 9, name: 'bare Rejected', input: { text: 'Rejected' }, expect: 'reject' },
  {
    n: 10,
    name: 'declined with reason',
    input: { text: 'Declined. Too expensive for a one-day trip.' },
    expect: 'reject',
    reasonContains: 'Too expensive',
  },
  { n: 11, name: 'bare No', input: { text: 'No' }, expect: 'reject' },
  {
    n: 12,
    name: 'not approved -- negation must beat the bare keyword',
    input: { text: 'Not approved.' },
    expect: 'reject',
    why: 'contains the literal substring "approved"; masking must claim it first',
  },
  {
    n: 13,
    name: 'cannot approve',
    input: { text: 'I cannot approve this right now.' },
    expect: 'reject',
  },
  {
    n: 14,
    name: "won't be approving",
    input: { text: "I won't be approving this trip." },
    expect: 'reject',
  },
  {
    n: 15,
    name: 'do not approve, with reason on the next line',
    input: { text: 'I do not approve.\nBudget is frozen until Q3.' },
    expect: 'reject',
    reasonContains: 'Budget is frozen',
  },

  // --- quoting: the highest-risk group -------------------------------------
  {
    n: 16,
    name: 'top-post approval above quoted original',
    input: { text: `Approved.${QUOTED_ORIGINAL}` },
    expect: 'approve',
  },
  {
    n: 17,
    name: 'top-post rejection above quoted original',
    input: { text: `Rejected - we can do this over a call.${QUOTED_ORIGINAL}` },
    expect: 'reject',
    reasonContains: 'over a call',
  },
  {
    n: 18,
    name: 'Outlook -----Original Message----- separator',
    input: {
      text: [
        'Approved',
        '',
        '-----Original Message-----',
        'From: Awign Travel <approvals@awign.example>',
        'Sent: 01 September 2026 18:04',
        'Subject: Travel approval needed',
        '',
        OUR_INSTRUCTION,
      ].join('\n'),
    },
    expect: 'approve',
  },
  {
    n: 19,
    name: 'REJECTION above a quote that contains our own "reply with Approved" text',
    input: { text: `No - not this month.${QUOTED_ORIGINAL}` },
    expect: 'reject',
    why: 'THE critical case: scanning the raw body would find "Approved" in our own quoted instruction and approve a rejection',
  },
  {
    n: 20,
    name: 'deep 5-level quoting under a fresh approval',
    input: {
      text: [
        'Approved.',
        '',
        '> > > > > Please reply with Approved or Yes',
        '> > > > earlier thread',
        '> > > older',
        '> > older still',
        '> oldest',
      ].join('\n'),
    },
    expect: 'approve',
  },
  {
    n: 21,
    name: 'quote-only reply with no new text',
    input: { text: QUOTED_ORIGINAL },
    expect: 'no_decision',
    why: 'nothing was actually typed by the manager',
  },
  {
    n: 22,
    name: 'bottom-post: decision after the quoted block',
    input: { text: `${QUOTED_ORIGINAL}\n\nApproved.` },
    expect: 'no_decision',
    why: 'we deliberately do NOT read past the quote marker; a clarification email is the safe outcome',
  },

  // --- HTML ----------------------------------------------------------------
  {
    n: 23,
    name: 'HTML-only approval',
    input: { html: '<div dir="ltr"><p>Approved.</p></div>' },
    expect: 'approve',
  },
  {
    n: 24,
    name: 'HTML with blockquote containing our instruction',
    input: {
      html: `<div dir="ltr"><p>Rejected.</p></div><blockquote class="gmail_quote"><p>${OUR_INSTRUCTION}</p></blockquote>`,
    },
    expect: 'reject',
    why: 'blockquote subtree must be removed BEFORE tags are flattened',
  },
  {
    n: 25,
    name: 'HTML with nested blockquotes',
    input: {
      html:
        '<p>Approved</p><blockquote><p>a</p><blockquote><p>reply with Rejected or No</p></blockquote></blockquote>',
    },
    expect: 'approve',
  },
  {
    n: 26,
    name: 'HTML entities around the keyword',
    input: { html: '<p>&nbsp;Approved&nbsp;&mdash; go ahead.</p>' },
    expect: 'approve',
  },
  {
    n: 27,
    name: 'gmail_quote div (not a blockquote)',
    input: {
      html: `<div>No.</div><div class="gmail_quote"><div>${OUR_INSTRUCTION}</div></div>`,
    },
    expect: 'reject',
  },

  // --- auto replies --------------------------------------------------------
  {
    n: 28,
    name: 'out-of-office by subject',
    input: { text: 'I am out of the office until 10 Sep.', subject: 'Automatic reply: Travel approval needed' },
    expect: 'no_decision',
    isAutoReply: true,
  },
  {
    n: 29,
    name: 'auto-submitted header with an "Approved" body',
    input: {
      text: 'Approved.',
      headers: { 'Auto-Submitted': 'auto-replied' },
    },
    expect: 'no_decision',
    isAutoReply: true,
    why: 'an autoresponder must never move money even when its body says Approved',
  },
  {
    n: 30,
    name: 'Precedence: bulk',
    input: { text: 'Approved', headers: { Precedence: 'bulk' } },
    expect: 'no_decision',
    isAutoReply: true,
  },
  {
    n: 31,
    name: 'Auto-Submitted: no is a REAL reply',
    input: { text: 'Approved', headers: { 'Auto-Submitted': 'no' } },
    expect: 'approve',
    isAutoReply: false,
    why: 'RFC 3834 says "no" means human-generated; must not be treated as automated',
  },

  // --- ambiguity -----------------------------------------------------------
  {
    n: 32,
    name: 'split decision across line items',
    input: { text: 'I approve the flight but reject the hotel.' },
    expect: 'ambiguous',
  },
  {
    n: 33,
    name: 'conditional approval',
    input: { text: 'Yes but only if the return date moves to the 7th.' },
    expect: 'ambiguous',
  },
  {
    n: 34,
    name: 'only if',
    input: { text: 'Approved only if finance signs off separately.' },
    expect: 'ambiguous',
  },
  {
    n: 35,
    name: 'a question, not a decision',
    input: { text: 'Can you tell me why the hotel is so expensive?' },
    expect: 'no_decision',
  },
  {
    n: 36,
    name: 'typo must NOT be fuzzy-matched',
    input: { text: 'Approvedd' },
    expect: 'no_decision',
    why: 'a clarification email costs nothing; a wrongly-approved trip does not',
  },

  // --- signatures and noise ------------------------------------------------
  {
    n: 37,
    name: 'Sent from my iPhone',
    input: { text: 'Approved.\n\nSent from my iPhone' },
    expect: 'approve',
  },
  {
    n: 38,
    name: 'RFC 3676 signature delimiter',
    input: { text: 'Approved\n\n-- \nPriya Sharma\nHead of Delivery\n+91 98765 43210' },
    expect: 'approve',
  },
  {
    n: 39,
    name: 'empty body',
    input: { text: '   \n\n  ' },
    expect: 'no_decision',
  },
  {
    n: 40,
    name: 'NBSP and bidi marks around the keyword',
    input: { text: '‎ Approved .‏' },
    expect: 'approve',
    why: 'invisible characters must not break the \\b word boundary',
  },
];
