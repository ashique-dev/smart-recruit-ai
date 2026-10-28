export const INFRASTRUCTURE_SCHEMA_VERSION = 1;
export const INFRASTRUCTURE_QUEUE = 'infrastructure-smoke';
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  components?: Record<string, 'up' | 'down'>;
}
