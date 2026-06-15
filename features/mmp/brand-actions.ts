'use server';

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export type BrandStatus = 'active' | 'deactive' | 'archived';

/**
 * Đổi trạng thái brand + cascade sang sản phẩm theo quy ước:
 *  - archived (ngừng hợp tác hẳn): TẤT CẢ sản phẩm → archived.
 *  - deactive (tạm dừng): sản phẩm đang active (curation='approved' / status='live')
 *    → draft. Sản phẩm đã archived giữ nguyên.
 *  - active: chỉ bật lại brand, không đụng sản phẩm (operator tự duyệt lại).
 */
export async function setBrandStatus(slug: string, status: BrandStatus): Promise<{ productsChanged: number }> {
  let productsChanged = 0;

  if (status === 'archived') {
    const r = await db.update(schema.mmpProducts)
      .set({ curationStatus: 'archived', status: 'archived' })
      .where(eq(schema.mmpProducts.brandSlug, slug));
    productsChanged = (r as unknown as { rowCount?: number }).rowCount ?? 0;
  } else if (status === 'deactive') {
    // "đang active" = curation approved. Đưa về draft (tạm dừng).
    const r = await db.update(schema.mmpProducts)
      .set({ curationStatus: 'draft', status: 'draft' })
      .where(and(
        eq(schema.mmpProducts.brandSlug, slug),
        eq(schema.mmpProducts.curationStatus, 'approved'),
      ));
    productsChanged = (r as unknown as { rowCount?: number }).rowCount ?? 0;
  }

  await db.update(schema.mmpBrands).set({ status }).where(eq(schema.mmpBrands.slug, slug));
  return { productsChanged };
}
