/**
 * THUẦN: tổng CÂN DỰ KIẾN SAU ĐÓNG THÙNG của các món trong một kiện (CEO 30/09/2026).
 *
 * CEO đã sửa cách hiểu của em, và chỗ này quan trọng: cân đội kho điền lúc QC KHÔNG phải cân
 * trần của sản phẩm. Lúc QC các bạn cân sản phẩm RỒI ĐẶT THỬ VÀO HỘP để chọn loại hộp vừa, và
 * điền cân DỰ KIẾN SAU KHI ĐÓNG — "cân thực tế sản phẩm chỉ 1 kg nhưng phải đóng thùng 3 kg
 * mới vừa thì điền 3". Nên số này ĐÃ tính hộp của riêng món đó.
 *
 * Bản đầu của tệp này ghi nhãn "chưa gồm thùng" — SAI, và sai theo hướng nguy hiểm: nó bảo
 * người đóng hàng cộng thêm hộp một lần nữa vào con số đã có hộp.
 *
 * Vẫn KHÔNG phải cân kiện: nhiều món gộp một thùng thì tổng cân dự kiến từng món CAO HƠN cân
 * kiện thật (mỗi món tính một hộp, nhưng cả kiện chỉ dùng một thùng). Nên đây là số THAM CHIẾU
 * để đối chiếu, không phải số thay cho lần cân thật lúc đóng.
 */

/** Nhãn bắt buộc đi kèm con số này ở mọi chỗ hiển thị. Có test canh. */
export const NHAN_DU_KIEN = 'cân dự kiến sau đóng thùng, cộng từ từng món — vẫn phải cân lại cả kiện';

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
  return `Dự kiến ${t.tongKg} kg từ ${t.soMon} món — ${NHAN_DU_KIEN}`;
}
