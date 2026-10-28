import { test, expect } from '@playwright/test';
test('SPA displays real API health and validates refresh settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Infrastructure status' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API ok');
  await expect(page.getByText('postgres: up')).toBeVisible();
  await page.getByLabel('Refresh interval (5–60 seconds)').fill('4');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a whole number');
  await page.getByLabel('Refresh interval (5–60 seconds)').fill('15');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Refreshing every 15 seconds.')).toBeVisible();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toHaveText('API ok');
  await page.goto('/unknown-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
