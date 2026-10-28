import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const api = 'auth companies memberships jobs candidates resumes resume-assessments candidate-rankings interview-invitations interview-sessions interview-engine interview-assessments ai-gateway notifications storage usage audit'.split(' ');
const boundaries = [...api.map(name => `apps/api/src/${name}`), ...['features', 'hooks', 'types'].map(name => `apps/web/src/${name}`)];
const implemented = new Set(['auth','companies','memberships','notifications','audit'].map(name => `apps/api/src/${name}`).concat('apps/web/src/features'));
test('all 20 boundaries have Git-visible documentation with accurate phase ownership', () => {
  const visible = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n'));
  for (const boundary of boundaries) {
    expect(visible.has(`${boundary}/README.md`)).toBe(true);
    expect(readFileSync(`${boundary}/README.md`, 'utf8')).toContain(implemented.has(boundary) ? 'Phase 2 implementation.' : 'No feature is implemented here in Phase 1');
  }
});
