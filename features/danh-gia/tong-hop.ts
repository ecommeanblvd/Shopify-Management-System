/**
 * THUẦN: tổng hợp đánh giá.
 *
 * CỐ Ý KHÔNG có hàm tính sao trung bình. Đo 45 bản ghi thật: 22 ca 5 sao và 21 ca
 * 1 sao, KHÔNG có ca 3 sao nào. Trung bình của phân bố hai cực ra ~3,0 — con số
 * đó không mô tả gì thật, nên module không cung cấp nó ở bất kỳ đâu.
 */
import { daXuLy } from './phan-loai';

export interface DongDanhGia {
  id: string;
  soSao: number;
  trangThai: string | null;
  vendor: string | null;
}

export interface NhomSao { soSao: number; soCa: number }

/** Phân bố 1…5 sao, luôn trả đủ 5 mức kể cả mức 0 ca — thiếu mức là đọc sai hình. */
export function gomTheoSao(ds: DongDanhGia[]): NhomSao[] {
  const m = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  for (const d of ds) {
    if (m.has(d.soSao)) m.set(d.soSao, (m.get(d.soSao) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[0] - a[0]).map(([soSao, soCa]) => ({ soSao, soCa }));
}

export interface NhomBrand {
  brand: string;
  soCa: number;
  soMotSao: number;
  /** 1–2 sao: đánh giá tệ, không chỉ 1 sao. */
  soSaoThap: number;
}

/**
 * Gom theo brand. Mỗi đánh giá đếm cho ĐÚNG MỘT brand — `vendor` là một cột, không
 * phải danh sách, nên không thể lặp lại lỗi cộng trùng của module sự cố.
 *
 * Đánh giá chưa rõ brand GIỮ lại thành nhóm riêng, không bỏ: bỏ chúng là che mất
 * phần đánh giá tệ không quy được về ai.
 */
export function gomTheoBrand(ds: DongDanhGia[]): NhomBrand[] {
  const m = new Map<string, NhomBrand>();
  for (const d of ds) {
    const brand = d.vendor?.trim() || '(chưa rõ brand)';
    const cur = m.get(brand) ?? { brand, soCa: 0, soMotSao: 0, soSaoThap: 0 };
    cur.soCa += 1;
    if (d.soSao === 1) cur.soMotSao += 1;
    if (d.soSao <= 2) cur.soSaoThap += 1;
    m.set(brand, cur);
  }
  return [...m.values()].sort((a, b) => b.soMotSao - a.soMotSao || b.soCa - a.soCa);
}

/**
 * Đánh giá CẦN CHỮA: 1–2 sao mà chưa ở trạng thái đã xử lý.
 *
 * Trạng thái TRỐNG tính là chưa xử lý (7/45 dòng Lark để trống) — thà hiện ra để
 * CX rà còn hơn âm thầm coi là xong.
 */
export function canChua(ds: DongDanhGia[]): DongDanhGia[] {
  return ds.filter((d) => d.soSao <= 2 && !daXuLy(d.trangThai));
}
