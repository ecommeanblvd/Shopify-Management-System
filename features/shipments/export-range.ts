/**
 * THUẦN: khoảng NGÀY SHIP cho export CSV đối soát phí ship (CEO 12/08).
 * Preset tính theo lịch VN (ops làm việc giờ VN, bill carrier cũng theo ngày VN).
 * Không I/O — test được.
 */

export type ExportPreset = 'all' | 'this_month' | 'last_month' | 'last_30d' | 'custom';

export interface DateRange {
  /** 'YYYY-MM-DD' — bao gồm ngày này. null = không giới hạn. */
  from: string | null;
  /** 'YYYY-MM-DD' — bao gồm TRỌN ngày này. null = không giới hạn. */
  to: string | null;
}

export const PRESET_LABELS: Record<ExportPreset, string> = {
  all: 'Tất cả',
  this_month: 'Tháng này',
  last_month: 'Tháng trước',
  last_30d: '30 ngày qua',
  custom: 'Tuỳ chọn…',
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Date → 'YYYY-MM-DD' theo NGÀY LỊCH VN. */
function vnYmd(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Ngày đầu/cuối tháng chứa `d` (giờ VN), trả 'YYYY-MM-DD'. */
function vnMonthBounds(d: Date, monthOffset = 0): { from: string; to: string } {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth() + monthOffset;
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0)); // ngày 0 của tháng sau = ngày cuối tháng này
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * Preset → khoảng ngày. `custom` trả nguyên giá trị người dùng nhập (đã
 * chuẩn hoá: thiếu 1 đầu vẫn hợp lệ = mở 1 phía; from > to thì tự đảo).
 */
export function presetRange(
  preset: ExportPreset,
  now: Date = new Date(),
  custom?: { from?: string | null; to?: string | null },
): DateRange {
  switch (preset) {
    case 'this_month': return vnMonthBounds(now, 0);
    case 'last_month': return vnMonthBounds(now, -1);
    case 'last_30d': {
      // 30 ngày gần nhất TÍNH CẢ hôm nay (29 ngày trước → hôm nay).
      const to = vnYmd(now);
      const from = vnYmd(new Date(now.getTime() - 29 * DAY_MS));
      return { from, to };
    }
    case 'custom': {
      const f = normalizeYmd(custom?.from);
      const t = normalizeYmd(custom?.to);
      if (f && t && f > t) return { from: t, to: f }; // gõ ngược → tự đảo, không báo lỗi
      return { from: f, to: t };
    }
    case 'all':
    default:
      return { from: null, to: null };
  }
}

/** 'YYYY-MM-DD' hợp lệ → giữ; rỗng/rác → null. */
function normalizeYmd(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : s;
}

/** Hậu tố tên file CSV theo khoảng ngày: '2026-08-01_2026-08-31' / 'tu-2026-08-01' / 'all'. */
export function rangeFileSuffix(r: DateRange): string {
  if (r.from && r.to) return `${r.from}_${r.to}`;
  if (r.from) return `tu-${r.from}`;
  if (r.to) return `den-${r.to}`;
  return 'all';
}

/** Mô tả khoảng ngày cho UI: 'Tháng này (01/08 – 31/08)'. */
export function describeRange(r: DateRange): string {
  const vn = (s: string) => s.split('-').reverse().slice(0, 2).join('/');
  if (r.from && r.to) return `${vn(r.from)} – ${vn(r.to)}`;
  if (r.from) return `từ ${vn(r.from)}`;
  if (r.to) return `đến ${vn(r.to)}`;
  return 'tất cả thời gian';
}
