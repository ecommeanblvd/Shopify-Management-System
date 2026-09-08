/**
 * THUẦN: parse + validate payload webhook MMP `POST /api/mmp/cogs` (chưa bật — xem docs/cogs.md)
 * thành `BangKe` (features/cogs/doc-bang-ke.ts) để đi chung luật ghép + hàm ghi với bảng kê xlsx
 * (features/cogs/bang-ke-import.ts, `apDungBangKeDaDoc`).
 *
 * Dòng không đúng hình dạng → dừng NGAY, `{ ok: false }` — không đoán, không bỏ qua từng phần.
 */
import type { BangKe, DongBangKe } from './doc-bang-ke';

const RE_PERIOD = /^\d{4}-\d{2}$/;

interface DongPayload {
  maDon: string; sku: unknown; qty: unknown; amount: unknown; currency: unknown; kind: unknown; code: string | null;
}

/** 'yyyy-mm' → { tuNgay: '01/mm/yyyy'; denNgay: 'dd/mm/yyyy' cuối tháng }. */
function khoangNgayTuPeriod(period: string): { tuNgay: string; denNgay: string } {
  const [y, m] = period.split('-').map(Number);
  const cuoiThang = new Date(y, m, 0).getDate();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return { tuNgay: `01/${p2(m)}/${y}`, denNgay: `${p2(cuoiThang)}/${p2(m)}/${y}` };
}

function chuoiKhongRong(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0; }
function soDuong(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

/** Validate + đọc một dòng `lines[]`/`offline[]` của payload. `nhan` để báo lỗi rõ dòng nào (vd "lines[0]"). */
function docDong(raw: unknown, nhan: string, maDonKey: 'orderNumber' | 'refCode'): { ok: true; dong: DongPayload } | { ok: false; loi: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, loi: `${nhan}: phải là object` };
  const r = raw as Record<string, unknown>;
  const maDon = r[maDonKey];
  if (!chuoiKhongRong(maDon)) return { ok: false, loi: `${nhan}: thiếu ${maDonKey}` };
  if (!chuoiKhongRong(r.sku)) return { ok: false, loi: `${nhan}: thiếu sku` };
  if (!soDuong(r.qty)) return { ok: false, loi: `${nhan}: qty phải là số dương` };
  if (!soDuong(r.amount)) return { ok: false, loi: `${nhan}: amount phải là số dương` };
  // Hợp đồng payload MMP hiện chỉ nhận VND (xem docs/cogs.md) — tiền tệ khác dừng ngay, không quy đổi ngầm.
  if (r.currency != null && String(r.currency).toUpperCase() !== 'VND') return { ok: false, loi: `Chưa hỗ trợ tiền tệ khác VND (dòng ${nhan})` };
  if (r.kind !== 'cogs' && r.kind !== 'return') return { ok: false, loi: `${nhan}: kind phải là 'cogs' hoặc 'return'` };
  return { ok: true, dong: { maDon, sku: r.sku, qty: r.qty, amount: r.amount, currency: r.currency, kind: r.kind, code: chuoiKhongRong(r.ref) ? r.ref : null } };
}

function thanhDongBangKe(d: DongPayload, ngay: string, hangSheet: number): DongBangKe {
  return {
    ngay, maDon: d.maDon, tenSp: '', sku: String(d.sku), sl: d.qty as number,
    giaNoiDia: null, ck: null, phiCustomize: null, tt: d.amount as number,
    code: d.code, hangSheet,
  };
}

export function docPayloadMmp(json: unknown): { ok: true; bangKe: BangKe } | { ok: false; loi: string } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { ok: false, loi: 'Payload phải là object' };
  const p = json as Record<string, unknown>;

  if (!chuoiKhongRong(p.brandSlug)) return { ok: false, loi: 'Thiếu brandSlug' };
  if (typeof p.period !== 'string' || !RE_PERIOD.test(p.period)) return { ok: false, loi: 'period phải dạng YYYY-MM' };

  const linesRaw = p.lines ?? [];
  if (!Array.isArray(linesRaw)) return { ok: false, loi: 'lines phải là mảng' };
  const offlineRaw = p.offline ?? [];
  if (!Array.isArray(offlineRaw)) return { ok: false, loi: 'offline phải là mảng' };
  if (linesRaw.length === 0 && offlineRaw.length === 0) return { ok: false, loi: 'Payload không có dòng nào (lines và offline đều rỗng)' };

  const { tuNgay, denNgay } = khoangNgayTuPeriod(p.period);
  const lines: DongBangKe[] = [];
  const returns: DongBangKe[] = [];
  let hangSheet = 0;

  for (const [i, raw] of linesRaw.entries()) {
    const r = docDong(raw, `lines[${i}]`, 'orderNumber');
    if (!r.ok) return r;
    hangSheet += 1;
    const d = thanhDongBangKe(r.dong, tuNgay, hangSheet);
    (r.dong.kind === 'return' ? returns : lines).push(d);
  }
  for (const [i, raw] of offlineRaw.entries()) {
    const r = docDong(raw, `offline[${i}]`, 'refCode');
    if (!r.ok) return r;
    hangSheet += 1;
    const d = thanhDongBangKe(r.dong, tuNgay, hangSheet);
    (r.dong.kind === 'return' ? returns : lines).push(d);
  }

  const bangKe: BangKe = { brand: p.brandSlug, period: p.period, tuNgay, denNgay, sheet: 'mmp', lines, returns, canhBao: [] };
  return { ok: true, bangKe };
}
