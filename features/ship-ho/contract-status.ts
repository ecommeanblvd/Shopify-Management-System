/**
 * THUẦN: trạng thái hiệu lực của 1 hợp đồng đối tác ship hộ + validate file
 * upload. Không I/O — test được.
 */

export type ContractState = 'active' | 'expiring_soon' | 'expired' | 'no_expiry' | 'not_yet';

export interface ContractStatus {
  state: ContractState;
  /** Số ngày còn lại tới hạn (âm = đã quá hạn). null khi không có ngày hết hạn. */
  daysLeft: number | null;
  label: string;
}

/** Ngưỡng cảnh báo "sắp hết hạn" — 30 ngày (đủ thời gian đàm phán gia hạn). */
export const EXPIRING_SOON_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' → mốc UTC nửa đêm; null nếu rỗng/sai định dạng. */
function toUtcDay(s: string | null | undefined): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Trạng thái hợp đồng theo ngày ký + ngày hết hạn (so với `now`).
 * - Chưa tới ngày ký → 'not_yet' (hợp đồng ký trước, hiệu lực sau).
 * - Không có ngày hết hạn → 'no_expiry' (vô thời hạn / chưa nhập).
 * - Quá hạn → 'expired'; còn ≤30 ngày → 'expiring_soon'; còn lại 'active'.
 */
export function contractStatus(
  c: { signedAt?: string | null; expiresAt?: string | null },
  now: Date = new Date(),
): ContractStatus {
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const signed = toUtcDay(c.signedAt);
  const expires = toUtcDay(c.expiresAt);

  if (signed !== null && signed > today) {
    return { state: 'not_yet', daysLeft: null, label: 'Chưa hiệu lực' };
  }
  if (expires === null) {
    return { state: 'no_expiry', daysLeft: null, label: 'Không thời hạn' };
  }
  const daysLeft = Math.round((expires - today) / DAY_MS);
  if (daysLeft < 0) return { state: 'expired', daysLeft, label: `Hết hạn ${Math.abs(daysLeft)} ngày trước` };
  if (daysLeft <= EXPIRING_SOON_DAYS) return { state: 'expiring_soon', daysLeft, label: `Còn ${daysLeft} ngày` };
  return { state: 'active', daysLeft, label: 'Còn hiệu lực' };
}

/** Định dạng file hợp đồng chấp nhận: PDF, Word, ảnh scan. */
export const ALLOWED_CONTRACT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_CONTRACT_BYTES = 25 * 1024 * 1024; // 25 MB — hợp đồng scan nhiều trang

/** Kiểm tra file trước khi upload. Trả lỗi tiếng Việt cho UI, null = hợp lệ. */
export function validateContractFile(f: { name: string; type: string; size: number }): string | null {
  if (f.size <= 0) return 'File rỗng';
  if (f.size > MAX_CONTRACT_BYTES) {
    return `File quá lớn (${(f.size / 1024 / 1024).toFixed(1)} MB) — tối đa 25 MB`;
  }
  const type = (f.type || '').toLowerCase();
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  // Một số trình duyệt gửi type rỗng → fallback theo đuôi file.
  const okByType = (ALLOWED_CONTRACT_TYPES as readonly string[]).includes(type);
  const okByExt = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'].includes(ext);
  if (!okByType && !okByExt) return 'Chỉ nhận PDF, Word (doc/docx) hoặc ảnh (jpg/png)';
  return null;
}
