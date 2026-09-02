'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { CITIES } from '@/lib/cities';
import { formatMoney } from '@/lib/utils';
import { saveDraftAction, submitRequestAction } from './actions';
import {
  CATEGORY_LABEL,
  CURRENCIES,
  EXPENSE_CATEGORIES,
  MODE_LABEL,
  TRAVEL_MODES,
  travelRequestSchema,
  type TravelRequestInput,
} from './schema';

export interface ProjectOption {
  code: string;
  name: string;
}

export interface RequestFormProps {
  requestId: string | null;
  defaults: Partial<TravelRequestInput>;
  projects: ProjectOption[];
  attachmentSlot?: React.ReactNode;
}

const EMPTY: TravelRequestInput = {
  fromCity: '',
  toCity: '',
  departureDate: '',
  returnDate: '',
  mode: 'FLIGHT',
  purpose: '',
  bookingLinks: [{ url: '' }],
  expenses: [{ category: 'TICKET', amount: 0, description: '' }],
  currency: 'INR',
  billTo: 'AWIGN',
  projectCode: '',
  managerEmail: '',
};

/**
 * The request form.
 *
 * Sectioned rather than one long scroll, because the fields fall into groups a
 * requester thinks about separately, and because a 20-field wall is where
 * people start guessing. The running total is pinned to the bottom for the same
 * reason the manager email leads with it: the number is the decision.
 */
export function RequestForm({ requestId, defaults, projects, attachmentSlot }: RequestFormProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<null | 'draft' | 'submit'>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = React.useState(false);

  const form = useForm<TravelRequestInput>({
    resolver: zodResolver(travelRequestSchema) as Resolver<TravelRequestInput>,
    defaultValues: { ...EMPTY, ...stripUndefined(defaults) },
    mode: 'onBlur',
  });

  const { register, control, handleSubmit, watch, setValue, getValues, formState } = form;

  const links = useFieldArray({ control, name: 'bookingLinks' });
  const expenses = useFieldArray({ control, name: 'expenses' });

  const watchedExpenses = watch('expenses');
  const currency = watch('currency');
  const billTo = watch('billTo');
  const projectCode = watch('projectCode');

  const total = (watchedExpenses ?? []).reduce((sum, row) => {
    const n = Number(row?.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  /** Server-side field errors are surfaced on the same inputs as client ones. */
  function applyFieldErrors(fieldErrors?: Record<string, string>) {
    if (!fieldErrors) return;
    for (const [path, message] of Object.entries(fieldErrors)) {
      form.setError(path as keyof TravelRequestInput, { type: 'server', message });
    }
  }

  async function onSaveDraft() {
    setPending('draft');
    setFormError(null);
    // Deliberately unvalidated: a draft is allowed to be half-finished, and a
    // form that refuses to save what you have is a form people abandon.
    const result = await saveDraftAction(getValues(), requestId);
    setPending(null);

    if (!result.ok) {
      setFormError(result.error);
      applyFieldErrors(result.fieldErrors);
      return;
    }
    toast.success('Draft saved');
    if (!requestId) router.replace(`/requests/${result.data.id}/edit`);
    else router.refresh();
  }

  const onSubmit = handleSubmit(async (values) => {
    setPending('submit');
    setFormError(null);
    const result = await submitRequestAction(values, requestId);
    setPending(null);

    if (!result.ok) {
      setFormError(result.error);
      applyFieldErrors(result.fieldErrors);
      return;
    }
    toast.success('Sent to your manager for approval');
    router.push(`/requests/${result.data.id}`);
    router.refresh();
  });

  function onBillToChange(next: 'AWIGN' | 'PROJECT') {
    setValue('billTo', next, { shouldDirty: true });
    if (next === 'PROJECT') {
      setProjectModalOpen(true);
    } else {
      // Switching back to Awign clears the code, so a stale project id can
      // never ride along on a request that is no longer billed to it.
      setValue('projectCode', '', { shouldDirty: true });
      form.clearErrors('projectCode');
    }
  }

  return (
    <form onSubmit={onSubmit} className="pb-24">
      <datalist id="city-options">
        {CITIES.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>

      {formError && (
        <Alert variant="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <div className="space-y-4">
        {/* --- route and dates ------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Route and dates</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="fromCity" required error={formState.errors.fromCity?.message}>
              <Input
                id="fromCity"
                list="city-options"
                autoComplete="off"
                placeholder="Bengaluru"
                aria-invalid={!!formState.errors.fromCity}
                {...register('fromCity')}
              />
            </Field>

            <Field label="To" htmlFor="toCity" required error={formState.errors.toCity?.message}>
              <Input
                id="toCity"
                list="city-options"
                autoComplete="off"
                placeholder="Delhi"
                aria-invalid={!!formState.errors.toCity}
                {...register('toCity')}
              />
            </Field>

            <Field
              label="Departure"
              htmlFor="departureDate"
              required
              error={formState.errors.departureDate?.message}
            >
              <Input
                id="departureDate"
                type="date"
                aria-invalid={!!formState.errors.departureDate}
                {...register('departureDate')}
              />
            </Field>

            <Field
              label="Return"
              htmlFor="returnDate"
              hint="Leave blank for a one-way trip"
              error={formState.errors.returnDate?.message}
            >
              <Input
                id="returnDate"
                type="date"
                aria-invalid={!!formState.errors.returnDate}
                {...register('returnDate')}
              />
            </Field>

            <Field label="Mode of travel" htmlFor="mode" required error={formState.errors.mode?.message}>
              <Select id="mode" {...register('mode')}>
                {TRAVEL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Approving manager"
              htmlFor="managerEmail"
              required
              hint="Their reply to the approval email is what decides this"
              error={formState.errors.managerEmail?.message}
            >
              <Input
                id="managerEmail"
                type="email"
                inputMode="email"
                placeholder="manager@awign.com"
                aria-invalid={!!formState.errors.managerEmail}
                {...register('managerEmail')}
              />
            </Field>

            <Field
              label="Purpose of travel"
              htmlFor="purpose"
              required
              className="sm:col-span-2"
              hint="One or two sentences. Finance reads this months later."
              error={formState.errors.purpose?.message}
            >
              <Textarea
                id="purpose"
                rows={3}
                placeholder="Client onboarding workshop with the Delhi operations team."
                aria-invalid={!!formState.errors.purpose}
                {...register('purpose')}
              />
            </Field>
          </CardBody>
        </Card>

        {/* --- booking links --------------------------------------------- */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Booking links</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => links.append({ url: '' })}>
              <Plus aria-hidden /> Add link
            </Button>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-muted-foreground">
              At least one link to the fare or room you priced. It is what makes the estimate
              checkable.
            </p>
            {links.fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    aria-label={`Booking link ${index + 1}`}
                    placeholder="https://www.makemytrip.com/…"
                    aria-invalid={!!formState.errors.bookingLinks?.[index]?.url}
                    {...register(`bookingLinks.${index}.url` as const)}
                  />
                  {formState.errors.bookingLinks?.[index]?.url && (
                    <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                      {formState.errors.bookingLinks[index]?.url?.message}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove booking link ${index + 1}`}
                  disabled={links.fields.length === 1}
                  onClick={() => links.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {formState.errors.bookingLinks?.root && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {formState.errors.bookingLinks.root.message}
              </p>
            )}
          </CardBody>
        </Card>

        {/* --- expenses --------------------------------------------------- */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Estimated costs</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="currency" className="text-xs text-muted-foreground">
                Currency
              </Label>
              <Select id="currency" className="h-8 w-24 text-xs" {...register('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => expenses.append({ category: 'OTHER', amount: 0, description: '' })}
              >
                <Plus aria-hidden /> Add row
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {expenses.fields.map((field, index) => (
              <div key={field.id} className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem_2.25rem]">
                <Select
                  aria-label={`Category for row ${index + 1}`}
                  {...register(`expenses.${index}.category` as const)}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Description for row ${index + 1}`}
                  placeholder="Return flight, economy"
                  {...register(`expenses.${index}.description` as const)}
                />
                <Input
                  aria-label={`Amount for row ${index + 1}`}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className="tabular text-right"
                  aria-invalid={!!formState.errors.expenses?.[index]?.amount}
                  {...register(`expenses.${index}.amount` as const)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove cost row ${index + 1}`}
                  disabled={expenses.fields.length === 1}
                  onClick={() => expenses.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            {formState.errors.expenses?.root && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {formState.errors.expenses.root.message}
              </p>
            )}
          </CardBody>
        </Card>

        {/* --- bill to ---------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Bill this trip to</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(['AWIGN', 'PROJECT'] as const).map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    billTo === option ? 'border-primary bg-primary/5 font-medium' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="billTo"
                    value={option}
                    checked={billTo === option}
                    onChange={() => onBillToChange(option)}
                    className="accent-[var(--color-primary)]"
                  />
                  {option === 'AWIGN' ? 'Awign (company cost)' : 'A project'}
                </label>
              ))}
            </div>

            {billTo === 'PROJECT' && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {projectCode ? (
                  <>
                    <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      {projectCode}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => setProjectModalOpen(true)}
                    >
                      Change
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => setProjectModalOpen(true)}>
                    Choose a project
                  </Button>
                )}
              </div>
            )}
            {formState.errors.projectCode && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {formState.errors.projectCode.message}
              </p>
            )}
          </CardBody>
        </Card>

        {attachmentSlot}
      </div>

      {/* --- sticky total ------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total estimated cost
            </p>
            <p className="tabular text-xl font-semibold leading-tight">
              {formatMoney(total, currency)}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onSaveDraft} disabled={pending !== null}>
              {pending === 'draft' ? 'Saving…' : 'Save draft'}
            </Button>
            <Button type="submit" disabled={pending !== null}>
              {pending === 'submit' ? 'Sending…' : 'Submit for approval'}
            </Button>
          </div>
        </div>
      </div>

      {projectModalOpen && (
        <ProjectDialog
          projects={projects}
          initial={projectCode ?? ''}
          onCancel={() => {
            // Cancelling with no code selected must not leave the form claiming
            // "Project" with nothing to bill — PRD 4.3's most important rule.
            if (!getValues('projectCode')) {
              setValue('billTo', 'AWIGN', { shouldDirty: true });
            }
            setProjectModalOpen(false);
          }}
          onConfirm={(code) => {
            setValue('projectCode', code, { shouldDirty: true, shouldValidate: true });
            setProjectModalOpen(false);
          }}
        />
      )}
    </form>
  );
}

/**
 * Choosing "Project" opens this and it cannot be confirmed empty. Cancelling
 * puts bill-to back to Awign rather than leaving an unbillable request behind.
 */
function ProjectDialog({
  projects,
  initial,
  onCancel,
  onConfirm,
}: {
  projects: ProjectOption[];
  initial: string;
  onCancel: () => void;
  onConfirm: (code: string) => void;
}) {
  const [code, setCode] = React.useState(initial);
  const [touched, setTouched] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const invalid = touched && !code.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-dialog-title"
    >
      <Card className="w-full max-w-md">
        <CardHeader className="flex items-center justify-between">
          <CardTitle id="project-dialog-title">Which project?</CardTitle>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onCancel}>
            <X aria-hidden />
          </Button>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A project ID is required. Without it Finance cannot allocate the cost, which is the
            whole reason this field exists.
          </p>

          {projects.length > 0 && (
            <Field label="Known projects" htmlFor="project-select">
              <Select
                id="project-select"
                value={projects.some((p) => p.code === code) ? code : ''}
                onChange={(e) => setCode(e.target.value)}
              >
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Project ID"
            htmlFor="project-code"
            required
            error={invalid ? 'Enter the project ID' : undefined}
            hint="Or type one that is not in the list yet"
          >
            <Input
              id="project-code"
              ref={inputRef}
              value={code}
              aria-invalid={invalid}
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="AWG-2026-014"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setTouched(true);
                if (code.trim()) onConfirm(code.trim());
              }}
            >
              Use this project
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}
