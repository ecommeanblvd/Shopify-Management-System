'use server';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { requirePerm } from '@/features/receiving/perm';
import { dungDongQc, type DongTho } from './qc-dong';
import type { DuLieuQcDon } from './types';

const TRUY_VAN = `query($id: ID!) {
  order(id: $id) {
    lineItems(first: 50) { nodes {
      sku
      variant { id title image { url } }
      product { id title
        images(first: 8) { nodes { url } }
        metafields(first: 50) { nodes {
          namespace key value
          reference { ... on Metaobject { displayName } }
          references(first: 10) { nodes { ... on Metaobject { displayName } } } } } } } } } }`;

/**
 * Ảnh + thuộc tính cho MỘT đơn, lấy THẲNG từ Shopify. KHÔNG lưu lại (CEO 24/09:
 * tiết kiệm storage, không nhân bản dữ liệu; ảnh luôn là bản mới nhất).
 *
 * Trả `null` khi hỏng — KHÔNG ném. Màn QC phải mở và bấm Đạt/Không đạt được kể
 * cả khi Shopify chết; mất ảnh và thuộc tính thôi, không chặn kho làm việc.
 * Đo thật 24/09: 444–615ms mỗi lượt, chi phí 5–45 điểm trên hạn mức 20.000 với
 * tốc độ hồi 1.000/giây — không có rủi ro chạm trần.
 */
export async function layDuLieuQc(storeId: string, shopifyOrderId: string): Promise<DuLieuQcDon | null> {
  await requirePerm('view_receiving');
  try {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!store) return null;
    const token = await getStoreToken(store.id);
    const r = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: TRUY_VAN, variables: { id: shopifyOrderId },
    }) as { data?: { order?: { lineItems?: { nodes?: DongTho[] } } | null } };
    const don = r.data?.order;
    if (!don) return null;
    return { dong: dungDongQc(don.lineItems?.nodes ?? []) };
  } catch (e) {
    console.error('[kho-nhan] layDuLieuQc lỗi:', e);
    return null;
  }
}

const TRUY_VAN_ID = `query($id: ID!) {
  order(id: $id) { lineItems(first: 50) { nodes { sku variant { id } } } } }`;

/**
 * ID biến thể của ĐÚNG dòng hàng này trong ĐÚNG đơn này, hỏi thẳng Shopify.
 *
 * Nhẹ hơn hẳn `layDuLieuQc` (chi phí ~5 điểm, không kéo ảnh và metafield) vì
 * chỉ dùng lúc ghi nhận hàng về — thao tác kho bấm liên tục.
 *
 * Vì sao không tra `shopify_variants` theo SKU: bảng đó chỉ chứa MỘT store, nên
 * hàng của store khác trượt hẳn (đo 24/09: chiếc Mirer không tra ra; tỉ lệ
 * chung 977/1082 = 90%). Và SKU trùng giữa hai store thì tra theo SKU còn chọn
 * NHẦM biến thể — tệ hơn là không có.
 *
 * Trả `null` khi hỏng: thiếu ID thì vẫn nhận hàng được, không chặn kho.
 */
export async function layIdBienThe(
  storeId: string, shopifyOrderId: string, sku: string,
): Promise<string | null> {
  try {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!store) return null;
    const token = await getStoreToken(store.id);
    const r = await graphqlCall({
      shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
      query: TRUY_VAN_ID, variables: { id: shopifyOrderId },
    }) as { data?: { order?: { lineItems?: { nodes?: { sku?: string | null; variant?: { id?: string } | null }[] } } | null } };
    const nodes = r.data?.order?.lineItems?.nodes ?? [];
    return nodes.find((n) => n.sku === sku)?.variant?.id ?? null;
  } catch (e) {
    console.error('[kho-nhan] layIdBienThe lỗi:', e);
    return null;
  }
}
