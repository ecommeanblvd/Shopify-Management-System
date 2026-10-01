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
 * Có `participantServices`: Shopify LỌC giá trả về từ carrier service theo danh sách dịch vụ
 * BẬT trong participant. Tên không khớp thì Shopify loại SẠCH và vùng thành không giao được —
 * sự cố 01/10/2026: Tinh Atelier bật "FedEx International Priority" (tên trước D-071) trong khi
 * callback trả "Standard Shipping"/"Express Shipping", cả 32 vùng câm lặng. Participant có mặt
 * và engine trả giá đúng khi gọi thẳng, nên nhìn từ ngoài tưởng đã chạy.
 *
 * Có `active`: rate đã TẮT không ra checkout. Không lấy trường này thì màn hình và mọi phép so
 * đều coi rate tắt như đang sống — bắt được 01/10/2026: tắt xong 1.829 rate mà phép so vẫn báo
 * lệch y nguyên.
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
                      active
                      rateProvider {
                        __typename
                        ... on DeliveryRateDefinition {
                          price { amount currencyCode }
                        }
                        ... on DeliveryParticipant {
                          carrierService { id name active }
                          participantServices { name active }
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

/**
 * Hình dạng phản hồi của `SHIPPING_QUERY` — ĐẶT CẠNH chính câu truy vấn (CEO 01/10/2026).
 *
 * Vì sao ở đây mà không ở từng script: bốn script soi/sửa ship đều đi cùng cái cây này, và
 * trước đó mỗi script tự `as any` để lách — nên sửa câu truy vấn không làm chỗ nào báo lỗi.
 * Để kiểu sát câu truy vấn thì ai đổi query sẽ thấy ngay chỗ nào đọc sai.
 *
 * Mọi nhánh đều `?` và mảng đều có thể thiếu: Shopify trả `null` cho nhánh không có dữ liệu, và
 * một kiểu khai "luôn có" chỉ chuyển lỗi từ lúc biên dịch sang lúc chạy.
 */
export interface GiaMucShopify { amount?: string | null; currencyCode?: string | null }
export interface DichVuThamGia { name?: string | null; active?: boolean | null }
export interface NhaCungCapGia {
  __typename?: string | null;
  price?: GiaMucShopify | null;
  carrierService?: { id?: string | null; name?: string | null; active?: boolean | null } | null;
  participantServices?: readonly DichVuThamGia[] | null;
}
export interface MucGiaoHang {
  name?: string | null; active?: boolean | null; rateProvider?: NhaCungCapGia | null;
}
export interface VungGiaoHang {
  name?: string | null;
  countries?: readonly { code?: { countryCode?: string | null; restOfWorld?: boolean | null } | null }[] | null;
}
export interface VungTheoNhomViTri {
  zone?: VungGiaoHang | null;
  methodDefinitions?: { edges?: readonly { node?: MucGiaoHang | null }[] | null } | null;
}
export interface NhomViTriProfile {
  locationGroupZones?: { edges?: readonly { node?: VungTheoNhomViTri | null }[] | null } | null;
}
export interface ProfileGiaoHang {
  name?: string | null;
  profileLocationGroups?: readonly NhomViTriProfile[] | null;
}
export interface KetQuaShippingQuery {
  deliveryProfiles?: { edges?: readonly { node?: ProfileGiaoHang | null }[] | null } | null;
}

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
