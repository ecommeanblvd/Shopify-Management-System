/**
 * THUẦN: phân loại lý do trả hàng, dựng TỪ DỮ LIỆU THẬT của CX (spec 27/09).
 *
 * Bộ lý do cũ của module (`damaged_package`, `wrong_item`, `missing_item`…)
 * thiên về hàng lỗi. Đo 1.414 yêu cầu thật: gần 60% là "không vừa" và "đổi ý",
 * còn hàng lỗi chỉ 29 ca. Giữ bộ cũ là CX chọn "other" cho gần hết.
 *
 * CX ghi lý do thành MỘT chuỗi hai tầng — `"Doesn't suit me (I ordered my usual
 * size)"` — nên ở đây tách sẵn hai tầng để lọc và đếm được.
 */

export interface LyDoPhu { ma: string; ten: string }
export interface LyDoChinh { ma: string; ten: string; phu: LyDoPhu[] }

/** Số trong chú thích là số ca đo được trên 1.414 yêu cầu của CX (01→09/2026). */
export const LY_DO: LyDoChinh[] = [
  {
    ma: 'khong_vua', ten: "Doesn't suit me",
    phu: [
      { ma: 'size_quen', ten: 'I ordered my usual size' },            // 451
      { ma: 'theo_bang_size', ten: 'I have used the size chart' },    // 168
      { ma: 'dat_nham_size', ten: 'I ordered a wrong size' },         // 89
      { ma: 'qua_khong_vua', ten: "It's a gift and it doesn't fit" }, // 38
      { ma: 'khong_neu', ten: 'Không nêu rõ' },                       // 140
    ],
  },
  { ma: 'doi_y', ten: 'I change my mind', phu: [] },                  // 123
  {
    ma: 'khac_mo_ta', ten: "It's different than described",
    phu: [
      { ma: 'khac_mau', ten: 'Different color' },                     // 69
      { ma: 'thieu_phu_kien', ten: "Doesn't come with accessories" }, // 14
      { ma: 'khong_neu', ten: 'Không nêu rõ' },                       // 12
    ],
  },
  { ma: 'hang_loi', ten: 'Defective item', phu: [] },                 // 29
  { ma: 'khac', ten: 'Khác', phu: [] },
];

const THEO_MA = new Map(LY_DO.map((l) => [l.ma, l]));

export function lyDoHopLe(chinh: string, phu: string | null): boolean {
  const l = THEO_MA.get(chinh);
  if (!l) return false;
  if (phu == null || phu === '') return true;
  return l.phu.some((p) => p.ma === phu);
}

/**
 * Ghép hai tầng thành một câu đọc được, ĐÚNG cách CX đang ghi trên Lark:
 * `"Doesn't suit me (I ordered my usual size)"`. Giữ nguyên dạng đó để đối
 * chiếu ngược với 1.414 dòng cũ mà không phải dịch qua lại.
 */
export function nhanLyDo(chinh: string, phu: string | null): string {
  const l = THEO_MA.get(chinh);
  if (!l) return chinh;
  const p = phu ? l.phu.find((x) => x.ma === phu) : null;
  return p ? `${l.ten} (${p.ten})` : l.ten;
}

/** Mã RMA đọc được: `RT` + số đơn bỏ `#`, đúng quy ước CX (RTTA1861, RHC1293). */
export function maRma(maDon: string, lanThu = 1): string {
  const s = maDon.trim().replace(/^#/, '').toUpperCase();
  return lanThu <= 1 ? `RT${s}` : `RT${s}-${lanThu}`;
}

/** Nơi hoàn tiền — đo CX: Store Credit 1.059 / Original Payment 82. */
export const NOI_HOAN = [
  { ma: 'store_credit', ten: 'Store Credit (website)' },
  { ma: 'original_payment', ten: 'Original Payment (bank)' },
] as const;
export type NoiHoan = (typeof NOI_HOAN)[number]['ma'];

/** Loại yêu cầu. Đổi hàng chỉ 22/1.414 nên vòng này chỉ GHI NHẬN, không dựng luồng riêng. */
export const LOAI_TRA = [
  { ma: 'refund', ten: 'Hoàn tiền' },
  { ma: 'exchange', ten: 'Đổi hàng' },
] as const;
export type LoaiTra = (typeof LOAI_TRA)[number]['ma'];
