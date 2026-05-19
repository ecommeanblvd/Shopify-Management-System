import { runQuery, type ConnectorStore } from '@/lib/shopify/connector';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { settingsViewerManifest } from './manifest';

const SHIPPING_QUERY = `query {
  deliveryProfiles(first: 10) {
    edges { node { name profileItems(first: 50) { edges { node { product { title } } } }
      profileLocationGroups { locationGroupZones(first: 20) {
        edges { node { zone { name } methodDefinitions(first: 20) {
          edges { node { name rateProvider { __typename } } } } } } } } } }
}`;

const CHECKOUT_QUERY = `query {
  checkoutBranding { designSystem { colors { global { brand } } } }
}`;

export interface CheckoutResult {
  status: 'available' | 'needs_migration';
  data: unknown;
}

export function parseCheckoutResult(data: unknown, errors?: unknown): CheckoutResult {
  const branding = (data as { checkoutBranding?: unknown } | null)?.checkoutBranding;
  if (branding) return { status: 'available', data: branding };
  // Stores not on Checkout Extensibility return null/errors for checkoutBranding.
  return { status: 'needs_migration', data: errors ?? null };
}

const connectorDeps = {
  isEnabled: (fk: string, sid: string) => isFeatureEnabled(fk, sid),
  graphql: graphqlCall,
  decryptToken: getStoreToken,
};

export async function readShipping(store: ConnectorStore): Promise<unknown> {
  return runQuery({
    store,
    featureKey: settingsViewerManifest.key,
    requiredScopes: ['read_shipping'],
    query: SHIPPING_QUERY,
    deps: connectorDeps,
  });
}

export async function readCheckout(store: ConnectorStore): Promise<CheckoutResult> {
  try {
    const data = await runQuery({
      store,
      featureKey: settingsViewerManifest.key,
      requiredScopes: ['read_checkout_branding'],
      query: CHECKOUT_QUERY,
      deps: connectorDeps,
    });
    return parseCheckoutResult(data);
  } catch {
    return { status: 'needs_migration', data: null };
  }
}
