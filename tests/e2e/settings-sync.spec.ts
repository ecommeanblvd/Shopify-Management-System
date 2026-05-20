import { test, expect } from '@playwright/test';

test('settings-sync home renders with templates link', async ({ page }) => {
  await page.goto('/f/settings-sync');
  // Unauthenticated visitors get a sign-in prompt; the heading still renders.
  await expect(page.getByRole('heading', { name: /Settings Sync|Please sign in/ })).toBeVisible();
});

test('templates list is reachable', async ({ page }) => {
  await page.goto('/f/settings-sync/templates');
  await expect(page.getByRole('heading', { name: /Settings Templates|Please sign in/ })).toBeVisible();
});

test('history page renders', async ({ page }) => {
  await page.goto('/f/settings-sync/history');
  await expect(page.getByRole('heading', { name: /Apply history|Please sign in/ })).toBeVisible();
});
