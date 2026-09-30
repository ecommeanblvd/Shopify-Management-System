/**
 * Kéo cân từng chiếc từ Lark về SMS — MỘT CHIỀU, Lark là nguồn sự thật (CEO 30/09/2026).
 *
 * Vì sao một chiều: đội kho cân từng chiếc rồi điền vào cột Lark `Weight (kg)`. SMS không có
 * ô nhập cân nào trong luồng hiện tại, nên không có gì để ghi ngược — và CEO đã chốt một chiều.
 * SMS KHÔNG BAO GIỜ ghi đè dữ liệu Lark ở đường này.
 *
 * CỐ Ý KHÔNG có `'use server'`: đây là hàm chạy phía máy chủ dùng chung, không phải endpoint
 * cho trình duyệt gọi. Để `'use server'` là mở một cổng công khai cho người lạ bắn đồng bộ.
 */
import { eq, inArray, isNull, and, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllWhInventoryRecords } from '@/features/lark/client';
import { canTuDongLark } from './can-tu-lark';

export interface KetQuaDongBoCan {
  /** Dòng Lark đọc được. */
  docLark: number;
  /** Chiếc trong SMS được cập nhật cân. */
  capNhat: number;
  /** Dòng Lark có cân nhưng KHÔNG khớp chiếc nào bên mình. */
  khongKhop: number;
  /** Dòng Lark có ô cân nhưng giá trị bị loại (≤0, >50 kg, rác). */
  canVoLy: number;
}

/**
 * Đồng bộ cân cho những chiếc CHƯA có cân.
 *
 * Chỉ điền chỗ trống, KHÔNG ghi đè số đã có: nếu sau này SMS có đường sửa cân thì lượt đồng bộ
 * không được quét mất thứ người ta vừa sửa. Muốn lấy lại số của Lark thì xoá cân bên mình trước.
 *
 * Nối bằng `lark_record_id`. KHÔNG nối bằng mã chiếc: SMS đánh `WH-2609-00028`, Lark đánh
 * `WH-34184` — hai hệ mã khác nhau, nối nhầm là gán cân của chiếc này sang chiếc khác.
 */
export async function dongBoCanTuLark(): Promise<KetQuaDongBoCan> {
  const canLay = await db.select({ id: schema.goodsReceiptItems.id, rec: schema.goodsReceiptItems.larkRecordId })
    .from(schema.goodsReceiptItems)
    .where(and(isNotNull(schema.goodsReceiptItems.larkRecordId), isNull(schema.goodsReceiptItems.weightKg)));
  const ra: KetQuaDongBoCan = { docLark: 0, capNhat: 0, khongKhop: 0, canVoLy: 0 };
  if (canLay.length === 0) return ra;

  const theoRecord = new Map(canLay.map((x) => [x.rec as string, x.id]));
  const dong = await listAllWhInventoryRecords();
  ra.docLark = dong.length;

  // Gom theo cân để ghi mỗi cân một lượt UPDATE thay vì mỗi chiếc một lượt: đội kho dùng
  // chung vài giá trị (0,4 · 0,5 · 0,7 kg), nên gom lại là vài lượt ghi thay vì hàng nghìn.
  const theoCan = new Map<number, string[]>();
  for (const d of dong) {
    const idSms = theoRecord.get(d.record_id);
    const coO = d.fields != null && d.fields['Weight (kg)'] != null && d.fields['Weight (kg)'] !== '';
    if (!coO) continue;
    if (!idSms) { ra.khongKhop++; continue; }
    const can = canTuDongLark(d.fields);
    if (can == null) { ra.canVoLy++; continue; }
    const g = theoCan.get(can) ?? [];
    g.push(idSms);
    theoCan.set(can, g);
  }

  for (const [can, ids] of theoCan) {
    for (let i = 0; i < ids.length; i += 500) {
      const lo = ids.slice(i, i + 500);
      await db.update(schema.goodsReceiptItems)
        .set({ weightKg: String(can) })
        .where(inArray(schema.goodsReceiptItems.id, lo));
      ra.capNhat += lo.length;
    }
  }
  return ra;
}

/** Đồng bộ cân cho đúng MỘT chiếc — dùng khi mở màn, không phải quét cả bảng. */
export async function dongBoCanMotChiec(itemId: string): Promise<number | null> {
  const [item] = await db.select({ rec: schema.goodsReceiptItems.larkRecordId, can: schema.goodsReceiptItems.weightKg })
    .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);
  if (!item?.rec || item.can != null) return null;
  const { getWhInventoryRecord } = await import('@/features/lark/client');
  const d = await getWhInventoryRecord(item.rec);
  const can = canTuDongLark(d?.fields);
  if (can == null) return null;
  await db.update(schema.goodsReceiptItems).set({ weightKg: String(can) })
    .where(eq(schema.goodsReceiptItems.id, itemId));
  return can;
}
