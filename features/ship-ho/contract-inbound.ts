/**
 * THUẦN: validate + chuẩn hoá payload hợp đồng MMP đẩy sang (POST
 * /api/mmp/ship-ho/contract). Không I/O — test được.
 *
 * Payload MMP (chốt 05/08/2026):
 *   { brandSlug, brandName?, contractType, title, version, generatedAt, html }
 */

export interface MmpContractPayload {
  brandSlug: string;
  brandName?: string | null;
  contractType: string;
  title: string;
  version: string;
  generatedAt: string;
  html: string;
}

export interface NormalizedContract {
  brandSlug: string;
  title: string;
  contractType: string;
  version: string;
  generatedAt: Date;
  html: string;
  /** Tên file hiển thị/tải về — có version để phân biệt các bản. */
  filename: string;
}

export type ParseResult =
  | { ok: true; value: NormalizedContract }
  | { ok: false; error: string };

/** HTML hợp đồng tối đa 5 MB — hợp đồng thật ~195KB (Phụ lục 01 có bảng phí
 *  ~200 điểm đến), ngưỡng này dư sức. */
export const MAX_CONTRACT_HTML_BYTES = 5 * 1024 * 1024;

/** Nhãn hiển thị theo loại hợp đồng MMP gửi. Loại lạ → hiện nguyên mã (không
 *  chặn: MMP thêm loại mới không cần SMS deploy). */
export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  fulfillment: 'Fulfillment',
  sales: 'Bán hàng',
  mou: 'MOU',
  nda: 'NDA',
};

export function contractTypeLabel(t: string | null | undefined): string | null {
  if (!t) return null;
  return CONTRACT_TYPE_LABELS[t.toLowerCase()] ?? t;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Slug an toàn cho tên file (bỏ dấu, ký tự lạ → '-'). */
function fileSafe(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'hop-dong';
}

export function parseMmpContract(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'payload phải là object' };
  const p = raw as Record<string, unknown>;

  const brandSlug = str(p.brandSlug);
  if (!brandSlug) return { ok: false, error: 'brandSlug required' };
  const contractType = str(p.contractType);
  if (!contractType) return { ok: false, error: 'contractType required' };
  const version = str(p.version);
  if (!version) return { ok: false, error: 'version required' };
  const html = typeof p.html === 'string' ? p.html : '';
  if (!html.trim()) return { ok: false, error: 'html required' };
  if (Buffer.byteLength(html, 'utf8') > MAX_CONTRACT_HTML_BYTES) {
    return { ok: false, error: 'html quá lớn (tối đa 5MB)' };
  }

  // generatedAt: thiếu/rác → lấy thời điểm nhận (không chặn hợp đồng vì 1 field phụ).
  const genRaw = str(p.generatedAt);
  const genMs = genRaw ? Date.parse(genRaw) : NaN;
  const generatedAt = Number.isNaN(genMs) ? new Date() : new Date(genMs);

  // title trống → dựng từ loại hợp đồng (không để bản ghi vô danh trong danh sách).
  const title = str(p.title) || `Hợp đồng ${contractType}`;

  return {
    ok: true,
    value: {
      brandSlug, title, contractType, version, generatedAt, html,
      filename: `${fileSafe(title)}-${version}.html`,
    },
  };
}
