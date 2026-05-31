'use client';

import { useState } from 'react';
import { Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const SHOPIFY_SUFFIX = '.myshopify.com';

/**
 * Strip the parts the operator might paste accidentally and return just
 * the handle.  Accepts any of:
 *
 *   "mirer-shop"
 *   "mirer-shop.myshopify.com"
 *   "https://mirer-shop.myshopify.com"
 *   "https://mirer-shop.myshopify.com/admin"
 *   "  Mirer-Shop  "
 *
 * and returns "mirer-shop".  Anything outside [a-z0-9-] is dropped so the
 * pattern validator can't be tricked.
 */
export function normaliseShopHandle(input: string): string {
  let s = input.trim().toLowerCase();
  // Strip protocol.
  s = s.replace(/^https?:\/\//, '');
  // Strip everything from the first slash onwards (e.g. "/admin").
  s = s.split('/')[0];
  // Strip the trailing .myshopify.com if present.
  if (s.endsWith(SHOPIFY_SUFFIX)) {
    s = s.slice(0, -SHOPIFY_SUFFIX.length);
  }
  // Discard anything outside the handle alphabet so a stray dot can't slip
  // through (e.g. someone typing "mirer.shop").
  s = s.replace(/[^a-z0-9-]/g, '');
  return s;
}

interface Props {
  /** Endpoint to GET on submit. The component appends `?shop=<handle>.myshopify.com`. */
  installPath: string;
}

/**
 * Connect-store input that only asks for the handle (`mirer-shop`) and
 * hard-codes the `.myshopify.com` suffix to prevent typos. The visible
 * field never carries the domain; a hidden field carries the full
 * `{handle}.myshopify.com` so the install API receives what it expects.
 */
export function ShopHandleInput({ installPath }: Props) {
  const [handle, setHandle] = useState('');
  const fullDomain = handle ? `${handle}${SHOPIFY_SUFFIX}` : '';
  const isValid = HANDLE_RE.test(handle);

  return (
    <form action={installPath} method="get" className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="shop-handle" className="text-xs uppercase tracking-wider text-muted-foreground">
          Shop handle
        </Label>
        <div className="flex items-stretch rounded-lg border border-input bg-input/30 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 transition-colors overflow-hidden">
          <input
            id="shop-handle"
            type="text"
            value={handle}
            onChange={(e) => setHandle(normaliseShopHandle(e.target.value))}
            onPaste={(e) => {
              // Pre-process the paste so "https://mirer-shop.myshopify.com"
              // becomes just "mirer-shop" the moment it lands.
              e.preventDefault();
              const pasted = e.clipboardData.getData('text');
              setHandle(normaliseShopHandle(pasted));
            }}
            placeholder="your-shop"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            pattern="[a-z0-9][a-z0-9-]{0,59}"
            maxLength={60}
            className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm font-mono outline-none"
          />
          <span
            className="select-none flex items-center px-3 text-sm font-mono text-muted-foreground bg-muted/40 border-l border-input"
            aria-hidden
          >
            {SHOPIFY_SUFFIX}
          </span>
        </div>
        {/* What the install API actually receives. Bound to the live handle. */}
        <input type="hidden" name="shop" value={fullDomain} />
        <p className="text-xs text-muted-foreground">
          Just the part before <span className="font-mono">.myshopify.com</span> — lowercase
          letters, numbers, or dashes. Pasting the full URL also works.
        </p>
        {handle && !isValid && (
          <p className="text-xs text-destructive">
            Handle must start with a letter or digit and use only lowercase
            letters, numbers, or dashes.
          </p>
        )}
        {isValid && (
          <p className="text-xs text-emerald-600 dark:text-emerald-500 font-mono" aria-live="polite">
            → {fullDomain}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full gap-2" disabled={!isValid}>
        <Plug className="size-4" />
        Continue to Shopify
      </Button>
    </form>
  );
}
