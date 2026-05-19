import { test, expect } from '@playwright/test';

test('home page renders the shell dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shopify Management' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Connect a store' })).toBeVisible();
});

test('connect-store page redirects unauthenticated users away from the form', async ({ page }) => {
  await page.goto('/stores/connect');
  // The connect page is auth-guarded: an unauthenticated visit must NOT show the form.
  await expect(page.getByPlaceholder('your-shop.myshopify.com')).toHaveCount(0);
});
