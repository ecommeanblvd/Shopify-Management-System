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
  icon: 'Heart' | 'Gift' | 'Bell' | 'TrendingDown' | 'Sparkles' | 'Eye' | 'Bookmark' | 'UserRound' | 'Palette';
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
    key: 'customer-account',
    name: 'Customer Account',
    description:
      'Trang tài khoản khách hàng tuỳ biến trên Shopify: theo dõi đơn (Journey), ' +
      'wishlist, loyalty, đổi/trả — cấu hình branding + module bật/tắt theo từng store. ' +
      'Ship qua Customer Account UI extension.',
    version: '1.0.0',
    icon: 'UserRound',
    accent: { fg: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10' },
    routes: { admin: '/f/customer-account' },
  },
  {
    key: 'style-quiz',
    name: 'Style Quiz',
    description:
      'Quiz phong cách khoa học: khách trả lời → ra mùa màu hợp da, dáng người, ' +
      'archetype → gợi ý sản phẩm theo catalog từng store. Gồm lý thuyết, cách set ' +
      'up và bật theo store. Ship như module trong Customer Account.',
    version: '1.0.0',
    icon: 'Palette',
    accent: { fg: 'text-fuchsia-600 dark:text-fuchsia-400', bg: 'bg-fuchsia-500/10' },
    routes: { admin: '/f/functions/style-quiz' },
  },
  {
    key: 'wishlist',
    name: 'Wishlist',
    description:
      'Customer-facing wishlist with multi-device sync, guest support, and ' +
      'conversion analytics. Replaces third-party Wishlist apps for stores that ' +
      'already use this operator dashboard.',
    version: '1.0.0',
    icon: 'Heart',
    accent: { fg: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
    routes: { admin: '/f/functions/wishlist', storefront: '/api/storefront/wishlist' },
  },
  {
    key: 'recently-viewed',
    name: 'Recently Viewed',
    description:
      'Track which products each shopper looks at and resurface them as a ' +
      'carousel on PDPs, the cart, or any page the operator drops a marker ' +
      'on. Conversion lever without intrusive popups; no email required.',
    version: '0.1.0',
    icon: 'Eye',
    accent: { fg: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-500/10' },
    routes: { admin: '/f/functions/recently-viewed', storefront: '/api/storefront/recently-viewed' },
  },
  {
    key: 'gift-registry',
    name: 'Gift Registry',
    description:
      'Share-first wishlist for weddings, birthdays, baby showers. Owners ' +
      'create a registry with an event date and message; guests reserve ' +
      'items so duplicates are avoided. Public viewer at /gr/[token].',
    version: '0.2.0',
    icon: 'Gift',
    accent: { fg: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
    routes: { admin: '/f/functions/gift-registry', storefront: '/api/storefront/gift-registry' },
  },
  {
    key: 'save-for-later',
    name: 'Save for later',
    description:
      'Cart-context shelf — shoppers stash items they almost bought, then ' +
      'move them back later. Captures high-intent abandons that wishlists ' +
      'miss because the shopper already engaged at the cart step.',
    version: '0.1.0',
    icon: 'Bookmark',
    accent: { fg: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10' },
    routes: { admin: '/f/functions/save-for-later', storefront: '/api/storefront/save-for-later' },
  },
];

export function getFunctionByKey(key: string): FunctionManifest | undefined {
  return FUNCTIONS.find((f) => f.key === key);
}
