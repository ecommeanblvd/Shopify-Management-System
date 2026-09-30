/**
 * THUẦN: tổng cân các MÓN trong một kiện, để điền sẵn ô cân lúc đóng hàng (CEO 30/09/2026).
 *
 * Vì sao: đội kho đã cân từng chiếc lúc QC và điền lên Lark; bắt người đóng hàng gõ lại là
 * gõ lại một con số đã có. CEO chốt "điền tổng cân món thôi" — KHÔNG tự cộng thêm cân thùng.
 *
 * ĐIỀU QUAN TRỌNG NHẤT Ở TỆP NÀY: con số trả về KHÔNG PHẢI cân kiện. Cân kiện còn thùng, túi
 * khí, hoá đơn. Chính CEO đã nói "đóng hàng sẽ là cân nặng của thùng cũng như cả kiện hàng".
 * Nên nơi hiện nó BẮT BUỘC phải nói rõ "chưa gồm thùng" — điền sẵn mà không nói thì người đóng
 * bấm lưu luôn, và mình có một cân kiện thiếu trọng lượng thùng, ra cước sai mà không ai biết.
 */

/** Nhãn bắt buộc đi kèm con số này ở mọi chỗ hiển thị. Có test canh. */
export const NHAN_CHUA_GOM_THUNG = 'tổng cân sản phẩm — chưa gồm thùng';

export interface MonCoCan { weightKg: number | null }

export interface TongCanMon {
  /** Tổng cân các món, hoặc null khi CHƯA đủ cân để cộng. */
  tongKg: number | null;
  /** Số món chưa có cân. >0 thì `tongKg` là null. */
  soMonThieuCan: number;
  soMon: number;
}

/**
 * Cộng cân các món.
 *
 * THIẾU MỘT MÓN LÀ KHÔNG CỘNG. Một tổng thiếu vế trông y hệt một tổng đủ — nó không tự nói
 * mình sai, và người đóng hàng không có cách nào biết. Thà để trống và nói thiếu mấy món.
 *
 * Cộng bằng số nguyên gam rồi chia lại: 0,4 + 0,7 trong dấu phẩy động ra 1,1000000000000001,
 * và con số đó đi thẳng vào ô cân rồi lên cước.
 */
export function tongCanMon(mon: readonly MonCoCan[]): TongCanMon {
  const soMon = mon.length;
  const thieu = mon.filter((m) => m.weightKg == null || !Number.isFinite(m.weightKg)).length;
  if (soMon === 0 || thieu > 0) return { tongKg: null, soMonThieuCan: thieu, soMon };
  const gam = mon.reduce((s, m) => s + Math.round((m.weightKg as number) * 1000), 0);
  return { tongKg: gam / 1000, soMonThieuCan: 0, soMon };
}

/** Câu hiện cạnh ô cân — nói rõ số ở đâu ra, hoặc vì sao không có. */
export function moTaTongCan(t: TongCanMon): string {
  if (t.soMon === 0) return 'Kiện chưa gắn món nào';
  if (t.soMonThieuCan > 0) {
    return `Chưa điền sẵn được: còn ${t.soMonThieuCan}/${t.soMon} món chưa có cân lúc kiểm`;
  }
  return `Điền sẵn ${t.tongKg} kg từ ${t.soMon} món — ${NHAN_CHUA_GOM_THUNG}`;
}
