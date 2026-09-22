/** THUẦN: luật hiển thị màn "Đóng hàng". Không đụng DB. */
import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
import type { TrangThaiKien } from './types';

const DIM_DIVISOR = 5000;

/** Cân quy đổi (D×R×C/5000) và cân tính cước = max(thực, quy đổi) làm tròn 0,1 rồi trần 0,5 —
 *  đúng luật FedEx trong engine. CHỈ để hiển thị, cước vẫn lấy từ engine. */
export function canQuyDoi(weightKg: number | null, dims: { l: number; w: number; h: number | null } | null): {
  quyDoi: number | null;
  tinhCuoc: number | null;
  /** Bên nào quyết định cước: cân cân được, hay cân quy đổi từ kích thước. */
  theo: 'thuc' | 'quy_doi' | null;
} {
  const quyDoi = dims && dims.h != null ? Math.round((dims.l * dims.w * dims.h / DIM_DIVISOR) * 1000) / 1000 : null;
  if (weightKg == null) return { quyDoi, tinhCuoc: null, theo: null };
  const raw = Math.max(weightKg, quyDoi ?? 0);
  const tinhCuoc = Math.ceil((Math.round(raw * 10) / 10 - 1e-9) / 0.5) * 0.5;
  return { quyDoi, tinhCuoc: Math.round(tinhCuoc * 1000) / 1000, theo: (quyDoi ?? 0) > weightKg ? 'quy_doi' : 'thuc' };
}

export function trangThaiKien(k: { trackingNumber: string | null; selectedCarrierKey: string | null; selectedCarrierBy: string | null; selectedCarrierAt: string | null }): TrangThaiKien {
  if (k.trackingNumber) return { ma: 'da_len_nhan', tracking: k.trackingNumber };
  if (k.selectedCarrierKey) return { ma: 'da_chon', hang: k.selectedCarrierKey, nguoi: k.selectedCarrierBy, luc: k.selectedCarrierAt };
  return { ma: 'cho_chon' };
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export function ngayVn(iso: string): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** THUẦN: ngày nhóm có ở TƯƠNG LAI không (theo lịch VN) — kiện Lark hẹn đi ngày khác. */
export function laNgayTuongLai(ngay: string, now = Date.now()): boolean {
  return ngay > ngayVn(new Date(now).toISOString());
}

/**
 * Nhóm theo ngày-lịch VN. Ngày ĐÃ QUA và hôm nay lên trước (mới nhất trên cùng), ngày Lark
 * hẹn đi trong TƯƠNG LAI dồn xuống cuối (gần nhất trước) — màn này để chọn line cho kiện
 * vừa đóng, không để kiện giữ chỗ 31/12 che mất việc hôm nay (CEO 22/09/2026).
 */
export function nhomTheoNgay<T extends { ngayDong: string }>(rows: T[], now = Date.now()): Array<{ ngay: string; kien: T[] }> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const d = ngayVn(r.ngayDong); m.set(d, [...(m.get(d) ?? []), r]); }
  const daQua: string[] = [], sapToi: string[] = [];
  for (const ngay of m.keys()) (laNgayTuongLai(ngay, now) ? sapToi : daQua).push(ngay);
  daQua.sort((a, b) => (a < b ? 1 : -1));
  sapToi.sort();
  return [...daQua, ...sapToi].map((ngay) => ({ ngay, kien: m.get(ngay)! }));
}

/** Trong mỗi ngày, gom tiếp theo kho xuất (SG/HN) đúng như view Lark Đức đang nhìn.
 *  Kho có tên đứng trước, kiện chưa biết kho xuống cuối. */
export function nhomTheoNgayVaBase<T extends { ngayDong: string; base: string | null }>(rows: T[], now = Date.now()): Array<{ ngay: string; theoBase: Array<{ base: string | null; kien: T[] }> }> {
  return nhomTheoNgay(rows, now).map(({ ngay, kien }) => {
    const m = new Map<string, T[]>();
    for (const k of kien) { const b = k.base ?? ''; m.set(b, [...(m.get(b) ?? []), k]); }
    const theoBase = [...m.entries()]
      .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
      .map(([b, ds]) => ({ base: b === '' ? null : b, kien: ds }));
    return { ngay, theoBase };
  });
}

/**
 * THUẦN: tên người để hiển thị. Ưu tiên tên thật đã lưu ở tài khoản; chưa có thì lấy phần
 * trước @ của email — "bduc13922@gmail.com · 18:01" đọc khó hơn hẳn "Bá Đức · 18:01".
 */
export function tenNguoiDung(ten: string | null | undefined, email: string | null | undefined): string | null {
  const t = ten?.trim();
  if (t) return t;
  const e = email?.trim();
  if (!e) return null;
  return e.includes('@') ? e.slice(0, e.indexOf('@')) : e;
}

export const conChonDuoc = (r: { suspendedAt?: string | null }, now = Date.now()) => !r.suspendedAt || new Date(r.suspendedAt).getTime() > now;

/** ok trước theo cước tăng dần, lỗi cuối. Rẻ nhất = rẻ nhất trong nhóm CHỌN được. */
export function xepQuote(rows: CarrierQuoteRow[], now = Date.now()): { rows: CarrierQuoteRow[]; reNhatKey: string | null } {
  const ok = rows.filter((r) => r.ok).sort((a, b) => (a.vndCost ?? Infinity) - (b.vndCost ?? Infinity));
  const loi = rows.filter((r) => !r.ok);
  const reNhat = ok.find((r) => conChonDuoc(r, now)) ?? null;
  return { rows: [...ok, ...loi], reNhatKey: reNhat?.carrierKey ?? null };
}
