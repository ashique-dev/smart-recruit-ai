import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
for (const service of ['api', 'worker', 'web']) {
  const uid = execFileSync('docker', [...args, 'exec', '-T', service, 'id', '-u'], { encoding: 'utf8' }).trim();
  if (uid === '0') throw new Error(`${service} runs as root`);
}
const source = new URL('../apps/web/src/routes/status.tsx', import.meta.url);
const original = readFileSync(source, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.env.APP_URL || 'http://localhost:8080');
  await expect(page.getByRole('status')).toHaveText('API ok');
  writeFileSync(source, original.replace('>Infrastructure status</h1>', '>Hot reload verified</h1>'));
  await expect(page.getByRole('heading', { name: 'Hot reload verified' })).toBeVisible({ timeout: 15000 });
  writeFileSync(source, original);
  await expect(page.getByRole('heading', { name: 'Infrastructure status' })).toBeVisible({ timeout: 15000 });
  console.log('PASS development API/worker/web run as non-root; Vite updates and restores UI through Nginx without navigation');
} finally {
  writeFileSync(source, original);
  await browser.close();
}
