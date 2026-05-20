import { test, expect } from '@playwright/test';

test('auth layout centers the card', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible();
});

test('dashboard layout redirects to sign-in when unauthenticated', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
});
