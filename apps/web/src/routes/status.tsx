import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { getHealth } from '@/services/health';
const schema = z.object({ seconds: z.number().int().min(5).max(60) });
type Settings = z.infer<typeof schema>;
export function StatusPage() {
  const [seconds, setSeconds] = useState(10);
  const health = useQuery({ queryKey: ['infrastructure-health'], queryFn: getHealth, refetchInterval: seconds * 1000, retry: false });
  const { register, handleSubmit, formState: { errors } } = useForm<Settings>({ resolver: zodResolver(schema), defaultValues: { seconds } });
  return <main className="mx-auto max-w-2xl px-6 py-16">
    <p className="text-sm font-medium text-slate-500">SmartRecruit AI · Phase 1</p>
    <h1 className="mt-3 text-3xl font-semibold tracking-tight">Infrastructure status</h1>
    <p className="mt-4 text-slate-600">Development foundation. Recruitment features arrive in later phases.</p>
    <section className="my-8 rounded-xl border bg-white p-6" aria-label="API health">
      <h2 className="font-semibold">API readiness</h2>
      <p role="status" className="my-3">{health.isPending ? 'Checking API…' : health.isError ? health.error.message : `API ${health.data.status}`}</p>
      {health.data?.components && <ul className="mb-4 space-y-1">{Object.entries(health.data.components).map(([name, state]) => <li key={name}>{name}: {state}</li>)}</ul>}
      <Button disabled={health.isFetching} onClick={() => void health.refetch()}>Check now</Button>
    </section>
    <form onSubmit={handleSubmit(value => setSeconds(value.seconds))} className="space-y-3">
      <label className="block" htmlFor="seconds">Refresh interval (5–60 seconds)</label>
      <input id="seconds" type="number" className="mr-3 rounded border p-2" aria-describedby={errors.seconds ? 'interval-error' : undefined} {...register('seconds', { valueAsNumber: true })} />
      <Button variant="outline" type="submit">Apply</Button>
      {errors.seconds && <p id="interval-error" role="alert">Enter a whole number from 5 to 60.</p>}
      <p className="text-sm text-slate-500">Refreshing every {seconds} seconds.</p>
    </form>
  </main>;
}
