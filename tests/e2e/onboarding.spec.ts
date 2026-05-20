import { test, expect } from '@playwright/test';

test('sign-up page renders the form', async ({ page }) => {
  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('sign-in page links to sign-up', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('link', { name: /Sign up/i })).toBeVisible();
});

test('admin users page redirects unauthenticated visitors', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/sign-in/);
});
