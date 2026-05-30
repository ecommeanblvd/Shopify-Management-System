import { test, expect } from '@playwright/test';

test('orders landing redirects unauthenticated users to sign-in', async ({ page }) => {
  await page.goto('/f/orders');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('orders store page redirects unauthenticated users to sign-in', async ({ page }) => {
  await page.goto('/f/orders/00000000-0000-0000-0000-000000000000');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('admin shopify-sync-health redirects unauthenticated users', async ({ page }) => {
  await page.goto('/admin/shopify-sync-health');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('shopify webhook endpoint exists (returns 4xx without HMAC)', async ({ request }) => {
  const res = await request.post('/api/webhooks/shopify/orders-create', {
    data: { id: 1 },
    headers: { 'content-type': 'application/json' },
  });
  // Either 401 (HMAC fail) or 400 (missing headers) — both prove the route is wired.
  expect([400, 401].includes(res.status())).toBe(true);
});
