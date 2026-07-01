/**
 * Lưới cân dùng cho bảng so sánh cước carrier: 0.5 → 20 kg, bước 0.5 kg = 40
 * mốc. Cả DHL / FedEx / Aramex đều publish tier theo chính lưới này, nên đây là
 * lưới so sánh chung. Thuần — không I/O.
 */
export const COMPARE_WEIGHT_GRID: readonly number[] = Array.from(
  { length: 40 },
  (_, i) => (i + 1) * 0.5,
);
