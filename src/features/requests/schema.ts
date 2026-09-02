import { z } from 'zod';

/**
 * The one description of what a travel request is.
 *
 * The same schema validates in the browser (instant feedback) and again in the
 * server action (authority). Client-side validation is a courtesy; a request
 * arriving straight at the action with a hand-rolled POST body must be judged
 * by exactly the same rules, or the rules are decoration.
 */

export const EXPENSE_CATEGORIES = [
  'TICKET',
  'ACCOMMODATION',
  'LOCAL_TRANSPORT',
  'MEALS',
  'OTHER',
] as const;

export const TRAVEL_MODES = ['FLIGHT', 'TRAIN', 'BUS', 'CAB', 'OTHER'] as const;

/** One currency per request — see the note on travel_requests.currency. */
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;

export const CATEGORY_LABEL: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  TICKET: 'Ticket',
  ACCOMMODATION: 'Accommodation',
  LOCAL_TRANSPORT: 'Local transport',
  MEALS: 'Meals',
  OTHER: 'Other',
};

export const MODE_LABEL: Record<(typeof TRAVEL_MODES)[number], string> = {
  FLIGHT: 'Flight',
  TRAIN: 'Train',
  BUS: 'Bus',
  CAB: 'Cab',
  OTHER: 'Other',
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form');

/**
 * `javascript:` and `data:` URLs are the reason this is not `z.string().url()`.
 * These links are rendered as anchors inside an email; a scheme check is the
 * only thing between a booking link and a script running in a mail client.
 */
const httpUrl = z
  .string()
  .trim()
  .min(1, 'Enter a link')
  .max(2048, 'That link is too long')
  .refine((u) => /^https?:\/\/[^\s<>"]+$/i.test(u), 'Links must start with http:// or https://');

export const expenseItemSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce
    .number({ invalid_type_error: 'Enter an amount' })
    .nonnegative('Amounts cannot be negative')
    .max(1e11, 'That amount looks wrong'),
  description: z.string().trim().max(500).optional().or(z.literal('')),
});

export const bookingLinkSchema = z.object({ url: httpUrl });

export const travelRequestSchema = z
  .object({
    fromCity: z.string().trim().min(2, 'Where are you travelling from?').max(120),
    toCity: z.string().trim().min(2, 'Where are you travelling to?').max(120),
    departureDate: isoDate,
    returnDate: isoDate.optional().or(z.literal('')),
    mode: z.enum(TRAVEL_MODES, { errorMap: () => ({ message: 'Pick a mode of travel' }) }),
    purpose: z.string().trim().min(10, 'Give Finance a sentence they can audit').max(2000),

    bookingLinks: z.array(bookingLinkSchema).min(1, 'Add at least one booking link'),
    expenses: z.array(expenseItemSchema).min(1, 'Add at least one estimated cost'),
    currency: z.enum(CURRENCIES),

    billTo: z.enum(['AWIGN', 'PROJECT']),
    projectCode: z.string().trim().max(60).optional().or(z.literal('')),

    managerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email('Enter your approving manager’s email address'),
  })
  .superRefine((v, ctx) => {
    // PRD 4.3: Project without a Project ID is the single most common data
    // defect in the spreadsheet this replaces, so it is a hard error in three
    // places — here, in the modal that captures it, and as a CHECK constraint.
    if (v.billTo === 'PROJECT' && !v.projectCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectCode'],
        message: 'A project ID is required when billing to a project',
      });
    }
    if (v.billTo === 'AWIGN' && v.projectCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectCode'],
        message: 'Remove the project ID, or change bill-to back to Project',
      });
    }
    if (v.fromCity.trim().toLowerCase() === v.toCity.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toCity'],
        message: 'Origin and destination cannot be the same city',
      });
    }
    if (v.returnDate && v.returnDate < v.departureDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['returnDate'],
        message: 'The return date cannot be before departure',
      });
    }
  });

export type TravelRequestInput = z.infer<typeof travelRequestSchema>;

/**
 * Drafts are allowed to be incomplete — that is what a draft is. Everything is
 * optional here, and completeness is only demanded at submit time by
 * `travelRequestSchema` and by the `chk_complete_when_not_draft` constraint.
 */
export const draftSchema = z.object({
  fromCity: z.string().trim().max(120).optional(),
  toCity: z.string().trim().max(120).optional(),
  departureDate: isoDate.optional().or(z.literal('')),
  returnDate: isoDate.optional().or(z.literal('')),
  mode: z.enum(TRAVEL_MODES).optional().or(z.literal('')),
  purpose: z.string().trim().max(2000).optional(),
  bookingLinks: z.array(bookingLinkSchema).default([]),
  expenses: z.array(expenseItemSchema).default([]),
  currency: z.enum(CURRENCIES).default('INR'),
  billTo: z.enum(['AWIGN', 'PROJECT']).optional().or(z.literal('')),
  projectCode: z.string().trim().max(60).optional(),
  managerEmail: z.string().trim().toLowerCase().optional(),
});

export type DraftInput = z.infer<typeof draftSchema>;

/** Sums a set of expense rows the same way the database trigger does. */
export function sumExpenses(rows: Array<{ amount: number | string }>): number {
  return rows.reduce((total, row) => {
    const n = typeof row.amount === 'number' ? row.amount : Number(row.amount);
    return total + (Number.isFinite(n) ? n : 0);
  }, 0);
}
