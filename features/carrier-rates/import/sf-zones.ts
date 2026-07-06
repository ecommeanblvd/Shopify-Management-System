/**
 * SF Express (ShunFeng) VN Export — map ISO-2 → zone (A-K) + nhãn zone + mốc cân.
 *
 * Nguồn: "ShunFeng express - Bảng giá Xuất.pdf" (Effective 01 Feb 2025). CHỈ map
 * các nước nêu ĐÍCH DANH trong bảng — danh sách zone đầy đủ (đặc biệt Zone G/H
 * châu Âu có "…") nằm ở tài liệu "Destination & Rate Zone Index" riêng của SF,
 * chưa có. Nước ngoài danh sách này → engine trả 'no_zone' (đúng: SF chưa cấu
 * hình cho nước đó). SE (Sweden) mờ ở cả G/H → xếp H theo cụm Bắc Âu.
 *
 * v1 CHỈ 0.5–19.5kg (bậc phẳng). Bậc per-kg ≥20kg (nhân theo tổng cân) KHÔNG
 * seed vì model tier hiện tại biểu diễn giá cố định/mốc, không phải giá×cân.
 */
export const SF_ISO_ZONE: Record<string, string> = {
  HK: 'A', MO: 'A', SG: 'A', TH: 'A', MY: 'A',
  CN: 'B', TW: 'B', KR: 'B',
  JP: 'C', KH: 'C', ID: 'C', MM: 'C', PH: 'C',
  AU: 'D', IN: 'D',
  MN: 'E',
  US: 'F', CA: 'F', MX: 'F',
  BE: 'G', NL: 'G', DE: 'G', FR: 'G', GB: 'G',
  AT: 'H', DK: 'H', ES: 'H', NO: 'H', SE: 'H',
  EG: 'I', QA: 'I', AE: 'I', TR: 'I',
  AR: 'J', BO: 'J', BR: 'J', CL: 'J', CO: 'J', EC: 'J', GT: 'J', PA: 'J', PE: 'J', UY: 'J',
  GH: 'K', JO: 'K', MA: 'K',
};

export const SF_ZONE_LABELS = [
  'Zone A',
  'Zone B',
  'Zone C',
  'Zone D',
  'Zone E',
  'Zone F',
  'Zone G',
  'Zone H',
  'Zone I',
  'Zone J',
  'Zone K',
] as const;

/** Mốc cân 0.5..19.5kg (bước 0.5). Bậc ≥20kg per-kg không nằm ở model tier. */
export const SF_TIER_UPPERS = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5,
];
