'use server';

import { pushUnsentBrandOrders, type BackfillResult } from '@/features/mmp/order-backfill-core';
import { requirePerm } from '@/features/receiving/perm';

export type { BackfillResult };

/**
 * Nút operator (có auth) → đẩy đơn brand chưa gửi sang MMP.
 *
 * Đây là export DUY NHẤT của tệp `'use server'` này, và nó phải luôn là như vậy: ba lõi đẩy
 * đơn nằm ở `order-backfill-core.ts` chính vì một export ở đây là một endpoint công khai
 * (xem chú thích đầu tệp đó). Thêm hàm mới vào tệp này = mở thêm một endpoint, nên hàm nào
 * vào đây cũng phải có cổng quyền NGAY TRONG THÂN HÀM.
 */
export async function backfillMmpOrders(opts?: { limit?: number }): Promise<BackfillResult> {
  await requirePerm('manage_fulfillment');
  return pushUnsentBrandOrders(opts);
}
