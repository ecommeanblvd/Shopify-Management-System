/**
 * Đẩy cân một chiếc từ SMS lên Lark — CHỈ KHI Ô LARK ĐANG TRỐNG (CEO 01/10/2026).
 *
 * Vì sao có đường này: sau khi bảng "Nhận hôm nay" có ô nhập cân (CEO 01/10), SMS cũng thành
 * một chỗ nhập cân. Đo ngay lượt kéo đầu tiên: 2 chiếc có cân trong SMS mà dòng Lark còn
 * trống — số đó sẽ VĨNH VIỄN không lên Lark nếu không có đường này, vì chiều ghi cũ đã bỏ.
 *
 * Vì sao "chỉ khi trống" là điều kiện BẮT BUỘC, không phải cho chắc: cột `Weight (kg)` trên
 * Lark là ô đội kho tự cân. Ghi đè lên đó là xoá số người ta vừa cân bằng số của mình —
 * im lặng, không ai biết, và không có bản sao nào để lấy lại. Nguồn sự thật vẫn là Lark
 * (CEO 30/09); đường này chỉ ĐIỀN CHỖ TRỐNG, không bao giờ sửa.
 *
 * CỐ Ý KHÔNG có `'use server'`: hàm chạy phía máy chủ dùng chung, không phải endpoint.
 */
import { and, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  listAllWhInventoryRecords, getWhInventoryRecord, updateWhInventoryRecord, type LarkRecord,
} from '@/features/lark/client';
import { COT_CAN_LARK } from './can-tu-lark';
import { docCanNhap } from './can-chiec';
import { docCheDoGhi, duocGhi, type CheDoGhi } from './day-lark';

export interface KetQuaDayCan {
  /** Chiếc trong SMS có cân VÀ có nối dòng Lark. */
  ungVien: number;
  /** Bỏ qua vì ô Lark ĐÃ có số — không đụng tới. */
  larkDaCo: number;
  /** Bỏ qua vì cân bên mình không hợp lệ (≤0, >50 kg, rác) — không đẩy rác sang Lark. */
  canVoLy: number;
  /** Bỏ qua vì không tìm thấy dòng Lark (đã xoá bên đó). */
  khongThayDong: number;
  /** Chặn bởi chế độ ghi — đếm nhưng không gửi gì. */
  dry: number;
  /** Bỏ qua ở PHÚT CHÓT: đọc lại ngay trước khi ghi thì ô Lark đã có số. */
  vuaBiDien: number;
  /** Ghi thật lên Lark. */
  ghi: number;
  /** Lỗi khi gọi Lark. */
  loi: number;
}

/** Ô cân trên một dòng Lark có đang TRỐNG không. Trống = `null`/thiếu/chuỗi rỗng. */
export function oCanLarkTrong(r: LarkRecord | null | undefined): boolean {
  if (!r) return false;
  const tho = r.fields?.[COT_CAN_LARK];
  return tho == null || tho === '';
}

export interface UngVienDayCan { recordId: string; can: number }

/**
 * THUẦN: chọn chiếc nào được đẩy cân lên Lark.
 *
 * Bỏ qua ba loại, mỗi loại một lý do riêng — gộp chung thành "không đẩy" là mất đúng phần
 * thông tin cần để biết vì sao một chiếc không bao giờ lên Lark.
 */
export function chonUngVienDayCan(
  smsCan: readonly { recordId: string; canKg: string | null }[],
  dongLark: readonly LarkRecord[],
): { chon: UngVienDayCan[]; larkDaCo: number; canVoLy: number; khongThayDong: number } {
  const theoId = new Map(dongLark.map((d) => [d.record_id, d]));
  const chon: UngVienDayCan[] = [];
  let larkDaCo = 0, canVoLy = 0, khongThayDong = 0;
  for (const s of smsCan) {
    const kq = docCanNhap(s.canKg);
    if (!kq.ok || kq.kg == null) { canVoLy++; continue; }
    const d = theoId.get(s.recordId);
    if (!d) { khongThayDong++; continue; }
    if (!oCanLarkTrong(d)) { larkDaCo++; continue; }
    chon.push({ recordId: s.recordId, can: kq.kg });
  }
  return { chon, larkDaCo, canVoLy, khongThayDong };
}

/**
 * @param daTai Bảng Lark đã tải sẵn ở chỗ gọi — xem `dongBoWhInventory`.
 *
 * Ảnh chụp bảng đó CŨ vài phút (lượt tải mất ~2 phút), nên nó chỉ dùng để LỌC ứng viên cho
 * rẻ. Trước mỗi lượt ghi còn đọc lại ĐÚNG dòng đó một lần nữa: trong hai phút kia kho có thể
 * vừa điền cân, và ghi theo ảnh cũ là đè mất số vừa điền.
 */
export async function dayCanLenLark(daTai?: LarkRecord[]): Promise<KetQuaDayCan> {
  const ra: KetQuaDayCan = {
    ungVien: 0, larkDaCo: 0, canVoLy: 0, khongThayDong: 0, dry: 0, vuaBiDien: 0, ghi: 0, loi: 0,
  };
  const smsCan = await db.select({
    recordId: schema.goodsReceiptItems.larkRecordId, canKg: schema.goodsReceiptItems.weightKg,
  }).from(schema.goodsReceiptItems)
    .where(and(isNotNull(schema.goodsReceiptItems.larkRecordId), isNotNull(schema.goodsReceiptItems.weightKg)));
  ra.ungVien = smsCan.length;
  if (smsCan.length === 0) return ra;

  const dong = daTai ?? (await listAllWhInventoryRecords());
  const loc = chonUngVienDayCan(smsCan as { recordId: string; canKg: string | null }[], dong);
  ra.larkDaCo = loc.larkDaCo; ra.canVoLy = loc.canVoLy; ra.khongThayDong = loc.khongThayDong;

  // Biến RIÊNG, không dùng chung `WH_GHI_LARK`: bật ghi thật cho đường nhận-KCS không có
  // nghĩa là đồng ý ghi cân, và ngược lại. Chung một biến là một cái bật mở hai cửa.
  const cheDo: CheDoGhi = docCheDoGhi(process.env.WH_GHI_CAN_LARK);
  for (const u of loc.chon) {
    if (!duocGhi(cheDo, u.recordId)) {
      ra.dry++;
      console.log('[kho-nhan] KHÔNG ghi cân lên Lark (chế độ %s):', cheDo.kieu, { dong: u.recordId, can: u.can });
      continue;
    }
    try {
      // Đọc lại ĐÚNG dòng này ngay trước khi ghi — xem ghi chú ở @param daTai.
      const moi = await getWhInventoryRecord(u.recordId);
      if (!moi) { ra.khongThayDong++; continue; }
      if (!oCanLarkTrong(moi)) { ra.vuaBiDien++; continue; }
      await updateWhInventoryRecord(u.recordId, { [COT_CAN_LARK]: u.can });
      ra.ghi++;
    } catch (e) {
      ra.loi++;
      console.error('[kho-nhan] ghi cân lên Lark lỗi:', u.recordId, e);
    }
  }
  return ra;
}
