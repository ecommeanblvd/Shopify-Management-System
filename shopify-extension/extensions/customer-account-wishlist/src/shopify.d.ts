// Ambient declarations for the Shopify Customer Account UI Extension runtime.
//
// The `@shopify/ui-extensions` package ships per-component JSX augmentations, but
// they are not pulled in automatically by `import '@shopify/ui-extensions/preact'`
// (its `.d.ts` is an empty re-export) and this package compiles with `types: []`.
// To keep `tsc --noEmit` green without wiring the full component barrel, we declare
// the Polaris web-component intrinsics (`s-*`) loosely and type the `shopify` global
// with just the surface this extension touches.

import 'preact';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      [tag: `s-${string}`]: any;
    }
  }
}

declare global {
  /** Minimal shape of the customer-account `shopify` global used by this extension. */
  const shopify: {
    sessionToken: { get(): Promise<string> };
    settings: {
      backend_url?: string;
      [key: string]: unknown;
    };
  };
}

export {};
