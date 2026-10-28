import type { HealthResponse } from '@smart-recruit/shared';
export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health/ready', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('API is not ready. Check the data services and migrations.');
  return response.json() as Promise<HealthResponse>;
}
