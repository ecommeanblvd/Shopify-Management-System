'use server';

import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { parseSkuCostsCsv } from './parse-sku-costs';
import { requirePerm } from '@/features/receiving/perm';

export interface ApplySkuCostsInput {
  storeId: string;
  csvText: string;
  filename: string;
}

export interface ApplySkuCostsResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

/*
 * `applySkuCosts` tự gác `manage_sku_costs` trong thân hàm. Tới 25/10/2026 hàm KHÔNG kiểm
 * quyền, và action nội tuyến của trang (`orders/[storeId]/costs/page.tsx:34-44`) cũng chỉ
 * kiểm "có đăng nhập" — quyền `manage_sku_costs` chỉ được kiểm ở thân trang (`:22`).
 *
 * Cổng quyền phải nằm TRONG THÂN HÀM, không ở `page.tsx`. Mỗi export của tệp `'use server'` là
 * một endpoint POST; thân trang chỉ chạy lúc RENDER nên một POST thẳng không kích hoạt nó, và
 * cổng duy nhất của dashboard (`app/(dashboard)/layout.tsx:10-11`) cũng là render. Nên mọi
 * phiên đăng nhập gọi được, kể cả 3 tài khoản vai `viewer`.
 *
 * Hậu quả: hàm UPSERT hàng loạt vào `sku_costs` theo (store, sku, effective_from) — ghi đè
 * giá vốn dự tính của cả một store chỉ bằng một CSV. Bảng này là nguồn giá vốn dự tính của
 * P&L/margin đơn hàng (`features/shopify-orders/dashboard-actions.ts:177`,
 * `features/cogs/own-cogs.ts:101`), nên sửa nó là bóp méo biên lợi nhuận mà CEO đọc.
 *
 * Khoá `manage_sku_costs` là ĐÚNG khoá của trang (`costs/page.tsx:22`). `userId` thôi là
 * trường của `input`: trước đây người gọi tự khai nên kẻ gọi thẳng đổ tên người khác vào
 * `uploaded_by`; giờ lấy từ `requirePerm`.
 */
export async function applySkuCosts(input: ApplySkuCostsInput): Promise<ApplySkuCostsResult> {
  const userId = await requirePerm('manage_sku_costs');
  const { rows, errors } = parseSkuCostsCsv(input.csvText);
  if (errors.length > 0) {
    return { inserted: 0, overwritten: 0, errors };
  }
  if (rows.length === 0) {
    return { inserted: 0, overwritten: 0, errors: [] };
  }

  // Count overwrites by counting existing rows matching incoming keys before insert.
  const existingCountRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM sku_costs
     WHERE store_id = ${input.storeId}
       AND (sku, effective_from) IN
           (${sql.join(rows.map((r) => sql`(${r.sku}, ${r.effectiveFrom}::date)`), sql`, `)})
  `);
  const overwritten = Number(existingCountRes.rows[0]?.count ?? 0);

  for (const r of rows) {
    await db.insert(schema.skuCosts)
      .values({
        storeId: input.storeId,
        sku: r.sku,
        costPerUnit: r.cost,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
        source: `csv:${input.filename}`,
        uploadedBy: userId,
      })
      .onConflictDoUpdate({
        target: [schema.skuCosts.storeId, schema.skuCosts.sku, schema.skuCosts.effectiveFrom],
        set: {
          costPerUnit: r.cost,
          currency: r.currency,
          source: `csv:${input.filename}`,
          uploadedBy: userId,
          uploadedAt: new Date(),
        },
      });
  }

  return { inserted: rows.length - overwritten, overwritten, errors: [] };
}
