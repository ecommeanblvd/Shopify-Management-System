// Ambient declarations for the Shopify Customer Account UI Extension runtime.
//
// The `@shopify/ui-extensions` package ships per-component JSX augmentations, but
// they are not pulled in automatically by `import '@shopify/ui-extensions/preact'`
// (its `.d.ts` is an empty re-export) and this package compiles with `types: []`.
// To keep `tsc --noEmit` green without wiring the full component barrel, we declare
// the Polaris web-component intrinsics (`s-*`) loosely and type the `shopify` global
// with just the surface this extension touches.
//
// The customer-account `shopify.authenticatedAccount.customer` is a reactive signal
// exposing only the customer `id`; display name / email / addresses are read from the
// Customer Account GraphQL API (`shopify://customer-account/api/.../graphql.json`).

import 'preact';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      [tag: `s-${string}`]: any;
    }
  }
}

declare global {
  /** Reactive value holder — read `.value` to get the current value. */
  interface ReadonlySignal<T> {
    readonly value: T;
  }

  interface AuthenticatedCustomer {
    id: string;
  }

  /**
   * The order in context on the `customer-account.order-status.block.render`
   * target. `id` is a Shopify GID (`gid://shopify/Order/<numericId>`) and `name`
   * is the merchant-facing number (e.g. `#1001`). Undefined until the order is
   * fully processed, or when the page is only pre-authenticated.
   *
   * NOTE: the SMS timeline API keys on the *internal* order UUID, not this Shopify
   * GID, so `OrderStatusBlock` matches on `name` against `getOrders()` to resolve
   * the internal id. The `order` signal is only present on the order-status target.
   */
  interface OrderStatusOrder {
    id: string;
    name: string;
  }

  /** Minimal shape of the customer-account `shopify` global used by this extension. */
  const shopify: {
    sessionToken: { get(): Promise<string> };
    settings: {
      backend_url?: string;
      [key: string]: unknown;
    };
    authenticatedAccount: {
      customer: ReadonlySignal<AuthenticatedCustomer | undefined>;
    };
    /** Only defined on the `customer-account.order-status.block.render` target. */
    order?: ReadonlySignal<OrderStatusOrder | undefined>;
  };
}

export {};
