// Resolve the store's myshopify domain for APIs that key on `shop` (e.g. the
// public wishlist endpoint). Preference order:
//   1. An explicit `shop` extension setting, if the merchant configured one.
//   2. The `dest` claim of the session token (the shop origin), decoded without
//      verification — we only read it, the SMS backend verifies signed calls.
export async function resolveShopDomain(): Promise<string | null> {
  const fromSettings = shopify.settings.shop;
  if (typeof fromSettings === 'string' && fromSettings) {
    return stripProtocol(fromSettings);
  }
  try {
    const token = await shopify.sessionToken.get();
    const dest = decodeJwtClaim(token, 'dest');
    return dest ? stripProtocol(dest) : null;
  } catch {
    return null;
  }
}

function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function decodeJwtClaim(token: string, claim: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const value = parsed[claim];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
