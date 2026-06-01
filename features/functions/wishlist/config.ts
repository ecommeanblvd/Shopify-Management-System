/**
 * Per-store Wishlist configuration. Persisted in
 * `store_function_settings.config` (jsonb) and surfaced both to the
 * admin form and to the storefront embed at boot.
 *
 * Defaults are conservative — the embed script renders sensibly even
 * when nothing has been configured for the store.
 */

import { z } from 'zod';

// 3- or 6-digit hex color (with #). 8-digit (alpha) is allowed too so
// operators can dim accents without writing custom CSS.
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const wishlistConfigSchema = z.object({
  /** Brand accent applied to the saved-state button background and the
   *  drawer count badge. Falls back to a clean rose when unset. */
  accentColor: z.string().regex(HEX_COLOR, 'Must be a hex color like #e11d48').optional(),
  /** Operator-controlled copy for the PDP button. Helpful for non-English
   *  storefronts. */
  buttonLabel: z.object({
    unsaved: z.string().max(40).optional(),
    saved: z.string().max(40).optional(),
  }).partial().optional(),
  /** Where the PDP button mounts relative to the product form. */
  buttonPosition: z.enum(['append', 'prepend']).optional(),
  /** Show a one-time "Save your wishlist" email-capture banner in the
   *  drawer after the shopper adds their first item (guest only). */
  emailCapture: z.object({
    enabled: z.boolean().optional(),
    headline: z.string().max(80).optional(),
    cta: z.string().max(40).optional(),
  }).partial().optional(),
});

export type WishlistConfig = z.infer<typeof wishlistConfigSchema>;

export const DEFAULT_WISHLIST_CONFIG: Required<{
  accentColor: string;
  buttonLabel: { unsaved: string; saved: string };
  buttonPosition: 'append' | 'prepend';
  emailCapture: { enabled: boolean; headline: string; cta: string };
}> = {
  accentColor: '#e11d48',
  buttonLabel: { unsaved: 'Add to wishlist', saved: 'Saved to wishlist' },
  buttonPosition: 'append',
  emailCapture: {
    enabled: true,
    headline: 'Save your wishlist across devices',
    cta: 'Save list',
  },
};

/** Merge a parsed (possibly partial) config blob with defaults so the
 *  embed never has to deal with `undefined` branches. */
export function resolveWishlistConfig(
  raw: unknown,
): typeof DEFAULT_WISHLIST_CONFIG {
  const parsed = wishlistConfigSchema.safeParse(raw ?? {});
  const cfg = parsed.success ? parsed.data : {};
  return {
    accentColor: cfg.accentColor ?? DEFAULT_WISHLIST_CONFIG.accentColor,
    buttonLabel: {
      unsaved: cfg.buttonLabel?.unsaved ?? DEFAULT_WISHLIST_CONFIG.buttonLabel.unsaved,
      saved: cfg.buttonLabel?.saved ?? DEFAULT_WISHLIST_CONFIG.buttonLabel.saved,
    },
    buttonPosition: cfg.buttonPosition ?? DEFAULT_WISHLIST_CONFIG.buttonPosition,
    emailCapture: {
      enabled: cfg.emailCapture?.enabled ?? DEFAULT_WISHLIST_CONFIG.emailCapture.enabled,
      headline: cfg.emailCapture?.headline ?? DEFAULT_WISHLIST_CONFIG.emailCapture.headline,
      cta: cfg.emailCapture?.cta ?? DEFAULT_WISHLIST_CONFIG.emailCapture.cta,
    },
  };
}
