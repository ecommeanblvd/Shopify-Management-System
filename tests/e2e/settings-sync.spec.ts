import { test, expect } from '@playwright/test';

test('settings-sync home redirects unauthenticated', async ({ page }) => {
  await page.goto('/f/settings-sync');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('templates redirects unauthenticated', async ({ page }) => {
  await page.goto('/f/settings-sync/templates');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('history redirects unauthenticated', async ({ page }) => {
  await page.goto('/f/settings-sync/history');
  await expect(page).toHaveURL(/\/sign-in/);
});
