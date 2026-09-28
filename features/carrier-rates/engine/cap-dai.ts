/**
 * THUẦN: dựng danh sách (nước, bề rộng, tiền tố) cần tra cho nhánh DẢI mã bưu chính.
 *
 * File này tồn tại vì một lỗi đã làm sập trang Đối soát phí ship (28/09/2026).
 *
 * `napDai` cũ nhận HAI danh sách rời — một danh sách nước, một danh sách mã bưu
 * chính — rồi ghép TÍCH DESCARTES giữa chúng. Đo trên dữ liệu thật: 76 nước ×
 * 6.717 tiền tố = **510.492 mảnh SQL, 1.531.476 tham số bind**. Hậu quả kép:
 *
 *  - Drizzle nổ `RangeError: Maximum call stack size exceeded` ngay lúc gộp câu
 *    lệnh, trước cả khi chạm tới Postgres.
 *  - Kể cả gộp được thì Postgres chỉ cho tối đa **65.535** tham số — vượt 23 lần.
 *
 * Và tích Descartes còn SAI về nghĩa: một mã bưu chính thuộc ĐÚNG MỘT nước, nên
 * 99% cặp sinh ra là vô nghĩa (tiền tố Việt Nam ghép với Đức). Giữ đúng cặp
 * (nước, mã) đo được 8.108 cặp — nhỏ hơn 63 lần và nằm dưới trần.
 */
import { tienToTheoDoDai } from './remote-range';

export interface DiemDen {
  country: string | null | undefined;
  postcode: string | null | undefined;
}

export interface CapDai {
  cc: string;
  doDai: number;
  khoa: string;
}

/**
 * Cặp cần tra, dựng TỪ TỪNG ĐIỂM ĐẾN — giữ nguyên quan hệ nước ↔ mã.
 *
 * Bỏ điểm thiếu nước hoặc thiếu mã: không có nước thì không khoanh được vùng
 * index, không có mã thì không có tiền tố nào để tra.
 */
export function capDaiTuDiem(diem: readonly DiemDen[]): CapDai[] {
  const m = new Map<string, CapDai>();
  for (const d of diem) {
    const cc = (d.country ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    for (const p of tienToTheoDoDai(d.postcode)) {
      m.set(`${cc}|${p.doDai}|${p.khoa}`, { cc, doDai: p.doDai, khoa: p.khoa });
    }
  }
  return [...m.values()];
}

/**
 * Đường TƯƠNG THÍCH cho nơi gọi chỉ có hai danh sách rời.
 *
 * Vẫn là tích Descartes, nên CHỈ dùng khi danh sách mã bưu chính rất ngắn — thực
 * tế là các luồng quote MỘT đơn (một mã, ≤12 tiền tố). Luồng hàng loạt phải
 * truyền điểm đến qua `capDaiTuDiem`.
 */
export function capDaiTuHaiDanhSach(
  nuoc: readonly string[],
  maBuuChinh: readonly (string | null | undefined)[],
): CapDai[] {
  const diem: DiemDen[] = [];
  for (const n of nuoc) for (const ma of maBuuChinh) diem.push({ country: n, postcode: ma });
  return capDaiTuDiem(diem);
}

/** Số mảnh SQL tối đa mỗi lượt truy vấn. */
export const LO_TOI_DA = 8000;

/**
 * Chia thành lô để KHÔNG BAO GIỜ chạm trần tham số của Postgres, kể cả khi đơn
 * hàng phủ thêm nước và mã mới. Mỗi cặp tốn 3 tham số nên 8.000 cặp = 24.000
 * tham số, còn cách trần 65.535 một quãng an toàn.
 *
 * Sửa đúng cặp đã giảm 63 lần, nhưng chỉ sửa cặp thì trần vẫn là thứ chờ sẵn khi
 * dữ liệu lớn lên — chia lô làm nó thành không thể chạm tới.
 */
export function chiaLo<T>(ds: readonly T[], coLo = LO_TOI_DA): T[][] {
  if (coLo < 1) throw new Error('Cỡ lô phải ≥ 1');
  const ra: T[][] = [];
  for (let i = 0; i < ds.length; i += coLo) ra.push(ds.slice(i, i + coLo));
  return ra;
}
