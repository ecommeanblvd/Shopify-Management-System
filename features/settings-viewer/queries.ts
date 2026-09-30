import { runQuery, type ConnectorStore } from '@/lib/shopify/connector';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { settingsViewerManifest } from './manifest';

/**
 * Giới hạn trang PHẢI đủ lớn: bản cũ để first:20 cho vùng và phương thức, nên màn hình xem cấu
 * hình CẮT IM LẶNG — đo 01/10/2026 thì Tinh Atelier có ~30 vùng và 39–40 phương thức mỗi vùng,
 * tức bản cũ chỉ cho thấy 40/72 vùng của MEAN BLVD và một nửa thang giá, mà không báo gì.
 * Cắt im lặng nguy hiểm hơn lỗi: người đọc tin là đã xem hết.
 *
 * Mức 5/50/60 là mức ĐÃ DÒ trên store thật — to hơn nữa thì Shopify chặn vì vượt trần chi phí
 * truy vấn (25/100/100 ra cost 1322 > 1000). Nới thêm phải dò lại, không đoán.
 */
/** Xuất ra để script rà soát dùng ĐÚNG câu này — chép lại là có ngày hai bên trôi khác nhau. */
export const SHIPPING_QUERY = `query {
  deliveryProfiles(first: 5) {
    edges {
      node {
        name
        profileLocationGroups {
          locationGroupZones(first: 50) {
            edges {
              node {
                zone {
                  name
                  countries {
                    code {
                      countryCode
                      restOfWorld
                    }
                  }
                }
                methodDefinitions(first: 60) {
                  edges {
                    node {
                      name
                      rateProvider {
                        __typename
                        ... on DeliveryRateDefinition {
                          price { amount currencyCode }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
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
