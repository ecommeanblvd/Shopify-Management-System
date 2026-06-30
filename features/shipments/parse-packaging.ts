/**
 * Parse the operator's Excel "Select VTĐG1" column (cột AA) into a
 * canonical packaging_type for the carrier-engine quote.
 *
 * The Excel value is a free-text inventory code, e.g.
 *   "MEAN-BOX-42x30x10-CAR-02-VTĐG1-WH-25611"  → 'box'
 *   "MEAN-PAK-VTĐG1-WH-25611"                   → 'bag' (PAK rate)
 *   "MEAN-BAG-soft-pouch-2025"                  → 'bag'
 * Falls through to `null` for any string that doesn't mention BOX, PAK
 * or BAG — the engine then uses its legacy weight rule.
 *
 * Pure helper — no DB / I/O. Operator spec: `BOX` → Package rate,
 * `PAK`/`BAG` → PAK rate.
 */

export type PackagingType = 'bag' | 'box';

/** Returns the packaging type for the engine, or NULL when the inventory
 *  code is ambiguous. Case-insensitive. */
export function parsePackagingType(
  inventoryCode: string | null | undefined,
): PackagingType | null {
  if (!inventoryCode) return null;
  // Normalise: strip separators that could break word matching ("-"
  // and "_" are common in operator codes). Upper-case once.
  const haystack = inventoryCode.toUpperCase().replace(/[-_]/g, ' ');
  // BOX wins when both BOX and BAG appear because rigid boxes ALWAYS
  // bill as Package — Pak rates only apply to soft envelopes.
  if (/\bBOX\b/.test(haystack)) return 'box';
  if (/\bPAK\b/.test(haystack)) return 'bag';
  if (/\bBAG\b/.test(haystack)) return 'bag';
  return null;
}

/** Bao dẹp (Pak) tối đa dày ~ngần này (cm). Dữ liệu vận hành: chiều mỏng nhất
 *  cụm ở 2 (bao dẹp) rồi nhảy lên 9-10+ (hộp), không có 3-8 → ngưỡng 4 tách sạch. */
export const PAK_MAX_THICKNESS_CM = 4;

/**
 * Suy packaging type từ DIMENSION khi không có mã đóng gói (XLSX). Vận hành nhập
 * Lark "Dimension (điền tay)":
 *   - 2 chiều (LxW, không có cao) → 'bag' (Pak).
 *   - 3 chiều nhưng chiều MỎNG NHẤT ≤ {PAK_MAX_THICKNESS_CM}cm (vd 43x20x2) →
 *     vẫn là bao dẹp → 'bag'.
 *   - 3 chiều có độ dày đáng kể (vd 40x30x10) → 'box'.
 * Dùng MIN cả 3 chiều nên không phụ thuộc thứ tự nhập (cao có thể ở vị trí 1/2/3).
 * Fallback CHÍNH XÁC hơn quy tắc theo-cân khi packaging_type trống. THUẦN.
 *
 * Trả null khi thiếu L hoặc W (không đủ tín hiệu) → engine lại fallback theo cân.
 */
export function inferPackagingFromDims(
  lengthCm: number | null | undefined,
  widthCm: number | null | undefined,
  heightCm: number | null | undefined,
): PackagingType | null {
  const l = Number(lengthCm), w = Number(widthCm), h = Number(heightCm);
  if (!(l > 0) || !(w > 0)) return null; // thiếu 2 chiều cơ bản → không suy
  if (!(h > 0)) return 'bag';            // 2 chiều = bao dẹp
  return Math.min(l, w, h) <= PAK_MAX_THICKNESS_CM ? 'bag' : 'box';
}
