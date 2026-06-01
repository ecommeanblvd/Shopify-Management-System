/**
 * Function registry — pluggable storefront-side features that can be
 * enabled per Shopify store. Distinct from `features/*` admin-only
 * features (markets, settings-sync, orders) which run entirely
 * inside this app.  A "function" has:
 *
 *   - Admin surface in `/f/functions/{key}` for configuration + analytics
 *   - REST endpoints under `/api/storefront/{key}/*` called by the
 *     embed script on the merchant's website
 *   - An activation row per store in `store_function_settings`
 *
 * Wishlist is the first function shipped.  Future entries (gift-registry,
 * back-in-stock, price-drop alerts) plug in by adding a manifest here.
 */

export interface FunctionManifest {
  key: string;
  name: string;
  description: string;
  version: string;
  /** Lucide icon name (rendered by the dashboard nav + overview card). */
  icon: 'Heart' | 'Gift' | 'Bell' | 'TrendingDown' | 'Sparkles';
  /** Tailwind accent classes for the icon tile on the overview page. */
  accent: { fg: string; bg: string };
  routes: {
    /** Admin landing page under `/f/functions/{key}`. */
    admin: string;
    /** Public endpoint prefix called by the embed script. */
    storefront?: string;
  };
}

export const FUNCTIONS: FunctionManifest[] = [
  {
    key: 'wishlist',
    name: 'Wishlist',
    description:
      'Customer-facing wishlist with multi-device sync, guest support, and ' +
      'conversion analytics. Replaces third-party Wishlist apps for stores that ' +
      'already use this operator dashboard.',
    version: '0.1.0',
    icon: 'Heart',
    accent: { fg: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
    routes: { admin: '/f/functions/wishlist', storefront: '/api/storefront/wishlist' },
  },
];

export function getFunctionByKey(key: string): FunctionManifest | undefined {
  return FUNCTIONS.find((f) => f.key === key);
}
