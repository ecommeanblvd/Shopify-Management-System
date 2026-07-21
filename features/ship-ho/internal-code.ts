/**
 * THUẦN: sinh mã đơn ship hộ KHỞI TẠO TỪ SMS — format `YY-INSMS-SV-NNNN`.
 * Prefix INSMS (≠ INSLG của MMP) → hai hệ không bao giờ đụng khoá dù mỗi bên
 * tự đếm; NNNN reset theo năm như MMP. Mã này đồng thời là `mmpRef` gửi MMP
 * (contract: MMP dùng ref như CHUỖI OPAQUE, không parse format).
 */

export function internalCodePrefix(now: Date): string {
  return `${String(now.getFullYear()).slice(2)}-INSMS-SV-`;
}

/** maxExisting = mã INSMS lớn nhất hiện có của năm (null nếu chưa có). */
export function nextInternalCode(now: Date, maxExisting: string | null): string {
  const prefix = internalCodePrefix(now);
  let n = 0;
  if (maxExisting && maxExisting.startsWith(prefix)) {
    const tail = Number(maxExisting.slice(prefix.length));
    if (Number.isFinite(tail)) n = tail;
  }
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

/**
 * THUẦN: nhận mã đơn CHÍNH THỨC MMP trả về trong response order.received (origin
 * sms) → kế hoạch cập nhật đơn: code + mmpRef = mã MMP; mã cũ operator nhập (thường
 * là reference của khách, vd #KLS1996) chuyển vào customerRef nếu đang trống.
 * Trả null nếu không có gì để đổi.
 */
export function planCodeAdoption(
  current: { code: string; customerRef: string | null },
  minted: unknown,
): { code: string; mmpRef: string; customerRef: string | null } | null {
  const m = typeof minted === 'string' ? minted.trim() : '';
  if (!m || m === current.code) return null;
  return {
    code: m,
    mmpRef: m,
    customerRef: current.customerRef ?? current.code,
  };
}
