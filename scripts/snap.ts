/**
 * Dev tool: screenshot any URL with Playwright so Claude can view the live app.
 *
 *   npx tsx scripts/snap.ts <url> [outfile.png]
 *
 * Reads optional auth cookie from env SNAP_COOKIE (raw `Cookie:` header value)
 * so dashboard pages behind Better-Auth can be captured without re-logging in.
 */
import { chromium } from '@playwright/test';

async function main() {
  const url = process.argv[2];
  const out = process.argv[3] ?? '/tmp/snap.png';
  if (!url) {
    console.error('usage: tsx scripts/snap.ts <url> [outfile.png]');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const cookie = process.env.SNAP_COOKIE;
  if (cookie) {
    const u = new URL(url);
    const cookies = cookie.split(';').map((pair) => {
      const idx = pair.indexOf('=');
      return {
        name: pair.slice(0, idx).trim(),
        value: pair.slice(idx + 1).trim(),
        domain: u.hostname,
        path: '/',
      };
    });
    await context.addCookies(cookies);
  }

  const page = await context.newPage();

  // Optional auto-login: fill the Better-Auth sign-in form once, reuse the
  // session for the target URL. Pass SNAP_EMAIL + SNAP_PASSWORD in env.
  const email = process.env.SNAP_EMAIL;
  const password = process.env.SNAP_PASSWORD;
  if (email && password) {
    const origin = new URL(url).origin;
    await page.goto(`${origin}/sign-in`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button:has-text("Sign in"), button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`status=${resp?.status()} final_url=${page.url()} saved=${out}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
