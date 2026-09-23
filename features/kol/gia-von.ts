export interface DongGiaVon { costPerUnit: string; currency: string; effectiveFrom: string }

/**
 * THUẦN: chọn dòng giá vốn áp cho một ngày.
 *
 * Lấy dòng có effective_from LỚN NHẤT mà vẫn <= ngày gửi. Nếu mọi dòng đều sau
 * ngày gửi thì trả null chứ KHÔNG lấy bừa dòng gần nhất — thà để trống cho
 * người dùng gõ tay còn hơn điền một con số sai vào báo cáo chi phí.
 */
export function chonGiaVon(ds: readonly DongGiaVon[], ngay: string): DongGiaVon | null {
  let tot: DongGiaVon | null = null;
  for (const d of ds) {
    if (d.effectiveFrom > ngay) continue;
    if (!tot || d.effectiveFrom > tot.effectiveFrom) tot = d;
  }
  return tot;
}
