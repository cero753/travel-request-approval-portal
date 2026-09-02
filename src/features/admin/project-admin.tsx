'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, Input } from '@/components/ui/primitives';
import { createProjectAction, setProjectActiveAction } from './actions';

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export function ProjectAdmin({ initial }: { initial: ProjectRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function add() {
    setErrors({});
    startTransition(async () => {
      const result = await createProjectAction({ code, name });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      setCode('');
      setName('');
      toast.success('Project added.');
      router.refresh();
    });
  }

  function toggle(row: ProjectRow) {
    startTransition(async () => {
      const result = await setProjectActiveAction(row.id, !row.active);
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Code" htmlFor="project-code" error={errors.code}>
          <Input
            id="project-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="AWG-2026-014"
            className="font-mono"
            aria-invalid={Boolean(errors.code)}
          />
        </Field>
        <Field label="Name" htmlFor="project-name" error={errors.name}>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Retail audit rollout — West"
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
        <Button type="button" onClick={add} disabled={pending || !code.trim() || !name.trim()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Add
        </Button>
      </div>

      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">No project codes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Code
                </th>
                <th scope="col" className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {initial.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono">{row.code}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant={row.active ? 'outline' : 'ghost'}
                      disabled={pending}
                      onClick={() => toggle(row)}
                    >
                      {row.active ? 'Active — deactivate' : 'Inactive — reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
