'use server';

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

export type BrandStatus = 'active' | 'deactive' | 'archived';

/**
 * Đổi trạng thái brand + cascade sang sản phẩm theo quy ước:
 *  - archived (ngừng hợp tác hẳn): TẤT CẢ sản phẩm → archived.
 *  - deactive (tạm dừng): sản phẩm đang active (curation='approved' / status='live')
 *    → draft. Sản phẩm đã archived giữ nguyên.
 *  - active: chỉ bật lại brand, không đụng sản phẩm (operator tự duyệt lại).
 *
 * Quyền kiểm Ở ĐÂY, không chỉ ở trang gọi. Trước 24/10/2026 hàm này KHÔNG có một dòng kiểm
 * quyền nào, mà `app/(dashboard)/f/mmp/[brandSlug]/page.tsx` chỉ dùng `manage_mmp_products`
 * để ẩn/hiện nút (`:83`) — ẩn nút KHÔNG chặn được ai gọi thẳng server action. Cửa vào trang
 * là `view_mmp_products` (`:71`), vai `viewer` cũng có, nên bất kỳ ai đăng nhập được đều đổi
 * được trạng thái brand. Và đây không phải một ô tuỳ chọn: `archived` ép TOÀN BỘ sản phẩm của
 * brand sang `archived`, `deactive` ép mọi sản phẩm `approved` về `draft` — một lệnh, không
 * hoàn tác.
 *
 * Đúng nếp đã viết rõ ở `features/kol/perm.ts:9-10` và `features/ship-ho/require-manage.ts:7-9`:
 * "server action gọi được ĐỘC LẬP với trang, nên không được tin trang đã gác hộ". Cổng đặt ở
 * hàm trong `features/` chứ không ở wrapper trong `page.tsx`: wrapper là một trong N chỗ gọi,
 * hàm này là cổng ghi DUY NHẤT.
 *
 * Không chặn nhầm ai: soát 24/10/2026, hàm này chỉ có MỘT chỗ gọi
 * (`.../[brandSlug]/page.tsx:87`) — không cron, không script. Và cả `admin` lẫn `operator`
 * đã có đủ bộ 4 khoá `mmp_products:*` (shim kiểm `.every()`), nên vá là đóng đúng phần dư.
 */
export async function setBrandStatus(slug: string, status: BrandStatus): Promise<{ productsChanged: number }> {
  await requirePerm('manage_mmp_products');
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
