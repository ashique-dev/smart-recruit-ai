export const INFRASTRUCTURE_SCHEMA_VERSION = 2;
export const INFRASTRUCTURE_QUEUE = 'infrastructure-smoke';
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  components?: Record<string, 'up' | 'down'>;
}
export type CompanyRole = 'COMPANY_ADMIN' | 'RECRUITER' | 'VIEWER';
export interface Workspace { id: string; name: string; revision: number; role: CompanyRole }
