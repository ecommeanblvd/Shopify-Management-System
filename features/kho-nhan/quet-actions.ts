'use server';

import { requirePerm } from '@/features/receiving/perm';
import { donCuaDong, donChoCoBienThe, type KetQuaDonCoBienThe } from './quet-queries';

/** Dòng đơn này thuộc đơn nào — màn hỏi "chuyển sang đơn #X?" trước khi tự nhảy. */
export async function traDonCuaDong(shopifyLineId: string): Promise<{ orderNumber: string } | null> {
  await requirePerm('view_receiving');
  return donCuaDong(shopifyLineId);
}

/** Quét mã biến thể khi CHƯA mở đơn → liệt kê các đơn đang chờ có hàng này để bấm chọn. */
export async function traDonCoBienThe(shopifyVariantId: string): Promise<KetQuaDonCoBienThe> {
  await requirePerm('view_receiving');
  return donChoCoBienThe(shopifyVariantId);
}
