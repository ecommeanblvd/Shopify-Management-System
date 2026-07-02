/**
 * Nhãn + màu cho 4 mức `addr_confidence` (verify địa chỉ US, xem
 * docs/superpowers/specs/2026-06-24-address-verify-tiers-design.md §3).
 * Dùng CHUNG giữa card địa chỉ ở Orders (components/shopify-orders/OrdersTable.tsx)
 * và Fulfillment (components/fulfillment/AddressVerifyCard.tsx) để nhãn/màu nhất quán.
 */
export interface AddrBadge {
  label: string;
  cls: string;
  /** true → card viền đỏ cảnh báo (chỉ mức undeliverable). */
  border: boolean;
}

export const CONFIDENCE_MAP: Record<string, AddrBadge> = {
  verified:        { label: '✓ Giao được', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', border: false },
  census_verified: { label: '✓ Xác nhận qua Census', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', border: false },
  zip_only:        { label: '⚠ Chưa xác minh số nhà (ZIP hợp lệ)', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', border: false },
  undeliverable:   { label: '⚠ Không giao được', cls: 'bg-red-500/15 text-red-700 dark:text-red-400', border: true },
};
