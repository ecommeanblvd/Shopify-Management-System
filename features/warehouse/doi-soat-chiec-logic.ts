/**
 * THUẦN: chốt chặn cho lượt đối soát trạng thái CHIẾC (`goods_receipt_items.stock_status`).
 */

/** Trần số chiếc được sửa trong một lượt, và tỷ lệ so với tổng chiếc đang giữ chỗ. */
export const TRAN_SUA_TOI_THIEU = 400;
export const TRAN_SUA_TY_LE = 0.6;

/**
 * Lý do KHÔNG sửa, hoặc `null` nếu an toàn.
 *
 * Vì sao cần: lượt này đổi trạng thái HÀNG LOẠT trên bảng định danh từng chiếc — mỗi dòng là
 * một món vật lý có mã, ảnh QC, vị trí kệ. Một truy vấn chọn sai điều kiện sẽ đánh dấu "đã
 * rời kho" cho hàng đang nằm trên kệ, và đó là thứ không dựng lại được từ sổ cái: `shipped`
 * làm chiếc biến mất khỏi tầm nhìn của allocator vĩnh viễn.
 *
 * Hai dấu hiệu, cùng họ với `lyDoTuChoiGhi` (D-256) và `lyDoKhongGui` (D-257):
 *  - 0 chiếc  → nghi truy vấn hỏng, không phải "đã sạch".
 *  - vượt trần → nghi điều kiện chọn sai. Trần nới rộng (60%, tối thiểu 400) vì lượt ĐẦU
 *    phải dọn được 311 chiếc tồn đọng từ 16/06–30/09; lượt sau chỉ còn vài chiếc mỗi ngày.
 */
export function lyDoKhongSuaChiec(soSua: number, tongDangGiuCho: number): string | null {
  if (soSua === 0) return 'Không chiếc nào cần sửa — nghi truy vấn hỏng chứ không phải đã sạch.';
  const tran = Math.max(TRAN_SUA_TOI_THIEU, Math.ceil(tongDangGiuCho * TRAN_SUA_TY_LE));
  if (soSua > tran) {
    return `Sẽ sửa ${soSua}/${tongDangGiuCho} chiếc đang giữ chỗ (trần ${tran}) — nghi điều kiện chọn sai, KHÔNG sửa.`;
  }
  return null;
}
