/**
 * Lấp email/tên/ghi chú khách và số đo cho đơn đã sync từ trước (CEO 27/09).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của script.
 *
 * CHỈ ĐỌC Shopify, chỉ ghi các cột mới. Store không cấp scope `read_customers`
 * thì bỏ qua phần khách nhưng VẪN lấp số đo và EDD — hai thứ đó nằm ở dòng
 * đơn, không phải dữ liệu khách được bảo vệ.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { tachEdd, locSoDo, tenKhach, type ThuocTinhDong } from './thong-tin-khach';

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

function truyVan(coKhach: boolean): string {
  return `query($sau: String) {
    orders(first: 50, after: $sau, sortKey: PROCESSED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name note
        ${coKhach ? 'customer { email firstName lastName }' : ''}
        lineItems(first: 250) { nodes { id customAttributes { key value } } }
      }
    }
  }`;
}

export interface KetQuaKhach { don: number; donGhi: number; dongGhi: number }

export async function lapThongTinKhach(onTin?: (s: string) => void): Promise<KetQuaKhach> {
  const stores = await db.select().from(schema.stores);
  const ket: KetQuaKhach = { don: 0, donGhi: 0, dongGhi: 0 };

  for (const store of stores) {
    const coKhach = (store.scopes ?? []).includes('read_customers');
    const token = await getStoreToken(store.id);
    const q = truyVan(coKhach);
    let sau: string | null = null;
    let trang = 0;

    for (;;) {
      const r = await graphqlCall({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
        query: q, variables: { sau },
      }) as {
        data?: { orders?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          nodes?: {
            id: string; note?: string | null;
            customer?: { email?: string | null; firstName?: string | null; lastName?: string | null } | null;
            lineItems?: { nodes?: { id: string; customAttributes?: ThuocTinhDong[] | null }[] };
          }[] } };
        extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
      };

      const dons = r.data?.orders?.nodes ?? [];
      for (const d of dons) {
        ket.don += 1;
        const email = d.customer?.email?.trim() || null;
        const ten = tenKhach(d.customer?.firstName, d.customer?.lastName);
        const note = d.note?.trim() || null;
        if (email || ten || note) {
          const u = await db.execute(sql`
            UPDATE shopify_orders SET
              customer_email = COALESCE(${email}::text, customer_email),
              customer_name  = COALESCE(${ten}::text, customer_name),
              order_note     = COALESCE(${note}::text, order_note)
            WHERE shopify_order_id = ${d.id}`);
          ket.donGhi += u.rowCount ?? 0;
        }

        for (const li of d.lineItems?.nodes ?? []) {
          const soDo = locSoDo(li.customAttributes);
          const ed = (li.customAttributes ?? [])
            .find((a) => a.key.trim().toLowerCase() === 'estimated delivery')?.value ?? null;
          const e = tachEdd(ed);
          if (soDo.length === 0 && e.min == null) continue;
          const u = await db.execute(sql`
            UPDATE shopify_order_lines SET
              so_do   = ${JSON.stringify(soDo)}::jsonb,
              edd_min = COALESCE(${e.min}::text, edd_min),
              edd_max = COALESCE(${e.max}::text, edd_max)
            WHERE shopify_line_id = ${li.id}`);
          ket.dongGhi += u.rowCount ?? 0;
        }
      }

      trang += 1;
      onTin?.(`${store.name} trang ${trang}: ${dons.length} đơn · ghi ${ket.donGhi} đơn / ${ket.dongGhi} dòng`);

      const pi = r.data?.orders?.pageInfo;
      if (!pi?.hasNextPage || !pi.endCursor) break;
      sau = pi.endCursor;

      // Xô 20.000 điểm hồi 1.000/giây — nghỉ khi cạn thay vì đợi lỗi 429.
      const con = r.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 20000;
      const hoi = r.extensions?.cost?.throttleStatus?.restoreRate ?? 1000;
      if (con < 3000) await nap(Math.ceil((5000 - con) / hoi) * 1000);
    }
  }
  return ket;
}
