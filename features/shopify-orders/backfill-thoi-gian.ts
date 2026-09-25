/**
 * Lấp thời gian xử lý + dự kiến giao cho các đơn ĐÃ sync từ trước.
 *
 * CỐ Ý KHÔNG có `'use server'` — đây là việc chạy một lần bằng script, không
 * phải endpoint cho trình duyệt.
 *
 * CHỈ ĐỌC từ Shopify và chỉ ghi vào ba cột mới của `shopify_order_lines`.
 * Không đụng giá, số lượng hay bất cứ thứ gì đã có.
 *
 * CẢNH BÁO VỀ Ý NGHĨA: `processing_*` lấy metafield HIỆN TẠI của sản phẩm.
 * Với đơn cũ, nếu brand đã sửa metafield thì con số này KHÔNG phải thứ khách
 * nhìn thấy lúc đặt. Chỉ `estimated_delivery` là đóng băng nên luôn đúng.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { rutThoiGianXuLy } from './thoi-gian-xu-ly';

const TRUY_VAN = `query($sau: String) {
  orders(first: 50, after: $sau, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      lineItems(first: 250) { nodes {
        id
        customAttributes { key value }
        product { id
          b: metafield(namespace: "theme", key: "estimateStartDate") { value }
          e: metafield(namespace: "theme", key: "estimateEndDate") { value } } } }
    }
  }
}`;

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KetQuaLap { don: number; dong: number; capNhat: number }

export async function lapThoiGianXuLy(
  onTin?: (s: string) => void,
): Promise<KetQuaLap> {
  const stores = await db.select().from(schema.stores);
  const ket: KetQuaLap = { don: 0, dong: 0, capNhat: 0 };

  for (const store of stores) {
    const token = await getStoreToken(store.id);
    let sau: string | null = null;
    let trang = 0;

    for (;;) {
      const r = await graphqlCall({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
        query: TRUY_VAN, variables: { sau },
      }) as {
        data?: { orders?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          nodes?: { id: string; lineItems?: { nodes?: Parameters<typeof rutThoiGianXuLy>[0][] } }[] } };
        extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
      };

      const dons = r.data?.orders?.nodes ?? [];
      const hang: { id: string; min: number | null; max: number | null; giao: string | null }[] = [];
      for (const d of dons) {
        ket.don += 1;
        for (const li of d.lineItems?.nodes ?? []) {
          const t = rutThoiGianXuLy(li);
          ket.dong += 1;
          // Dòng không có gì để ghi thì bỏ qua hẳn — đỡ một lượt UPDATE vô ích.
          if (t.soNgayMin == null && t.soNgayMax == null && t.duKienGiao == null) continue;
          hang.push({
            id: (li as { id?: string }).id!, min: t.soNgayMin, max: t.soNgayMax, giao: t.duKienGiao,
          });
        }
      }

      if (hang.length > 0) {
        // MỘT câu UPDATE cho cả trang, khớp theo gid dòng đơn (duy nhất toàn cầu).
        const gt = sql.join(hang.map((h) => sql`(${h.id}, ${h.min}::int, ${h.max}::int, ${h.giao}::text)`), sql`, `);
        const kq = await db.execute(sql`
          UPDATE shopify_order_lines l
          SET processing_min_days = v.mn, processing_max_days = v.mx, estimated_delivery = v.gi
          FROM (VALUES ${gt}) AS v(lid, mn, mx, gi)
          WHERE l.shopify_line_id = v.lid`);
        ket.capNhat += kq.rowCount ?? 0;
      }

      trang += 1;
      onTin?.(`${store.name} trang ${trang}: ${dons.length} đơn, cập nhật ${ket.capNhat}`);

      const pi = r.data?.orders?.pageInfo;
      if (!pi?.hasNextPage || !pi.endCursor) break;
      sau = pi.endCursor;

      /* Hạn mức Shopify là một xô 20.000 điểm hồi 1.000/giây. Mỗi trang tốn
       * ~562 điểm, chạy liên tục là cạn sau ~35 trang rồi ăn 429. Thấy xô
       * xuống thấp thì nghỉ cho nó hồi, đừng để lỗi rồi mới xử lý. */
      const con = r.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 20000;
      const hoi = r.extensions?.cost?.throttleStatus?.restoreRate ?? 1000;
      if (con < 3000) await nap(Math.ceil((5000 - con) / hoi) * 1000);
    }
  }
  return ket;
}
