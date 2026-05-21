import { test, expect } from '@playwright/test';

test.describe('Markets feature (unauthenticated)', () => {
  test('markets list page redirects to sign-in', async ({ page }) => {
    await page.goto('/f/markets');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('new market page redirects to sign-in', async ({ page }) => {
    await page.goto('/f/markets/new');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('apply page redirects to sign-in', async ({ page }) => {
    await page.goto('/f/markets/apply');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('history page redirects to sign-in', async ({ page }) => {
    await page.goto('/f/markets/history');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
