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
