'use server';

import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

export interface KetQuaDanhDauTem {
  /** Số món ĐÃ ghi được mốc in tem. */
  da: number;
  /**
   * Món KHÔNG ghi được vì chưa có dòng `wh_nhan_kcs` (chưa ai lưu kết quả nhận cho món đó).
   * Trả về danh sách định danh chứ không chỉ con số để màn in tem gọi tên đúng món còn thiếu.
   */
  chuaNhan: string[];
}

/**
 * Ghi mốc đã in tem để biết món nào chưa dán.
 *
 * Mốc này nằm ở `wh_nhan_kcs.tem_in_luc`, mà dòng `wh_nhan_kcs` CHỈ tồn tại sau khi món đã được
 * lưu qua `ghiNhanKcs`. Luồng kho thật lại hay đi ngược: kiện về → "In tem cả đơn" → dán tem →
 * mới cân/kiểm từng món. Lúc bấm "Xong" thì chưa món nào có dòng, `update … where in (…)` chạm 0
 * dòng — bản cũ vẫn trả `{ da: 0 }` và màn khoe xanh "Đã đánh dấu 0 món", tức là báo thành công
 * cho một việc KHÔNG hề được ghi (review cuối 23/09/2026 I3). Nay trả về cả phần KHÔNG ghi được
 * để màn nói đúng sự thật; không bịa dòng `wh_nhan_kcs` rỗng chỉ để giữ cờ, vì bảng đó là kết
 * quả KCS (số lượng, cân, đạt/không) — dòng rỗng còn tệ hơn cái bug này.
 */
export async function danhDauDaInTem(dinhDanhs: string[]): Promise<KetQuaDanhDauTem> {
  await requirePerm('manage_qc');
  const ds = [...new Set(dinhDanhs.map((x) => x.trim()).filter(Boolean))];
  if (ds.length === 0) return { da: 0, chuaNhan: [] };
  const r = await db.update(schema.whNhanKcs)
    .set({ temInLuc: new Date() })
    .where(inArray(schema.whNhanKcs.monDinhDanh, ds))
    .returning({ monDinhDanh: schema.whNhanKcs.monDinhDanh });
  const daGhi = new Set(r.map((x) => x.monDinhDanh));
  return { da: daGhi.size, chuaNhan: ds.filter((x) => !daGhi.has(x)) };
}
