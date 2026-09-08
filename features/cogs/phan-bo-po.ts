/**
 * THUẦN: phân bổ hàng PO (MEAN mua đứt của brand, kê theo mã #MBLVDPO/#MTB trong
 * `brand_cogs_offline`) xuống các dòng đơn Shopify KHÔNG có trên bảng kê đối soát.
 * CEO chốt 08/09/2026:
 *   - Dòng đơn không được brand kê theo đơn mà SKU (mã + size + màu) có trong PO
 *     → chắc chắn lấy từ PO đó.
 *   - Nhập trước dùng trước (FIFO): chỉ PO nhập TRƯỚC khi phát sinh đơn mới được tính;
 *     hết số lượng thì chuyển sang PO kế tiếp. Không có ngày nhập PO → dùng KỲ kê
 *     trên sheet (YYYY-MM) làm mốc: PO kỳ ≤ tháng đặt đơn.
 *   - Giá vốn = giá mua trong PO đó (amount/qty); một dòng SL>1 có thể lấy từ 2 PO.
 */

export interface DongPO { refCode: string; period: string; sku: string; qty: number; amountVnd: number }
export interface DongDon { orderId: string; shopifyLineId: string; maDon: string; sku: string | null; qty: number; thangDat: string; ngayDat: string }
export interface PhanBo { orderId: string; shopifyLineId: string; maDon: string; sku: string; thangDat: string; amountVnd: number; tuPO: Array<{ refCode: string; period: string; qty: number; donGiaVnd: number }> }
export interface KhongPhanBo { orderId: string; shopifyLineId: string; maDon: string; sku: string | null; thangDat: string; lyDo: 'không có SKU trong PO' | 'PO hết số lượng' | 'chưa có PO trước tháng đặt' | 'thiếu SKU' }

const SIZES = new Set(['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', 'FREE', 'F', 'OS', 'CUSTOMIZE']);
const laMaDenio = (t: string) => /^(PK)?(DN)?0*\d{3,4}$/i.test(t);
const chuanDenio = (c: string) => c.toUpperCase().replace(/^PKDN0*(\d+)$/, 'PK$1').replace(/^PK0*(\d+)$/, 'PK$1').replace(/^DN0*(\d+)$/, 'DN$1');

/**
 * Tách SKU brand bất kỳ: bỏ tiền tố brand (phần đầu trước '-'), bỏ chất liệu 'PLA' và hậu tố -PO/-Sale,
 * tìm token SIZE đầu tiên; phần trước size = mã sản phẩm (có thể nhiều đoạn: 'FW25-01'), phần sau = màu.
 *   'Denio-DN0729+PK0729-M-CRE'      → codes [DN729, PK729], size M, colours [CRE]
 *   'LaVierge-FW25-01-S-NBEI-PLA'    → codes ['FW25-01'],     size S, colours [NBEI]
 *   'HappyClothing-VD0176-Customize-PIN' → codes ['VD0176'], size CUSTOMIZE, colours [PIN]
 * Mã kiểu Denio (DN0729/PKDN0729/PK0729) được chuẩn hoá để bundle ↔ PO rời ghép được.
 */
export function tachSkuDenio(sku: string): { codes: string[]; size: string | null; colours: string[] } {
  const parts = sku.replace(/-(PO|Sale)$/i, '').split('-').slice(1).map((x) => x.trim()).filter((x) => x && !/^PLA$/i.test(x));
  const iSize = parts.findIndex((t) => SIZES.has(t.toUpperCase()));
  // Không có size (phụ kiện Denio 'PKDN0729-CRE'): token đầu là mã, phần còn lại là màu.
  const truoc = iSize >= 0 ? parts.slice(0, iSize) : parts.slice(0, 1);
  const sau = iSize >= 0 ? parts.slice(iSize + 1) : parts.slice(1);
  const denio = truoc.flatMap((t) => t.split('+')).filter(laMaDenio);
  const codes = denio.length ? [...new Set(denio.map(chuanDenio))] : (truoc.length ? [truoc.join('-').toUpperCase()] : []);
  return { codes, size: iSize >= 0 ? parts[iSize].toUpperCase() : null, colours: sau.map((t) => t.toUpperCase()) };
}

/** Khoá ghép PO ↔ dòng đơn: mã chính (Denio: mã DN…, khác: cả cụm mã) + size + màu. */
export function khoaSku(sku: string): string | null {
  const t = tachSkuDenio(sku);
  const main = t.codes.find((c) => c.startsWith('DN')) ?? t.codes[0];
  if (!main) return null;
  return `${main}|${t.size ?? ''}|${t.colours.join('&')}`;
}

const soPO = (ref: string) => Number((ref.match(/(\d+)$/) ?? [])[1] ?? 0);

export function phanBoPO(dongDon: DongDon[], dongPO: DongPO[]): { phanBo: PhanBo[]; khong: KhongPhanBo[] } {
  // Kho PO theo khoá, mỗi khoá là danh sách lô theo thứ tự nhập (kỳ, số PO).
  const kho = new Map<string, Array<{ refCode: string; period: string; conLai: number; donGia: number }>>();
  for (const p of [...dongPO].sort((a, b) => a.period.localeCompare(b.period) || soPO(a.refCode) - soPO(b.refCode) || a.refCode.localeCompare(b.refCode))) {
    if (!(p.qty > 0)) continue;
    const k = khoaSku(p.sku); if (!k) continue;
    const lo = kho.get(k) ?? []; lo.push({ refCode: p.refCode, period: p.period, conLai: p.qty, donGia: p.amountVnd / p.qty }); kho.set(k, lo);
  }
  const phanBo: PhanBo[] = []; const khong: KhongPhanBo[] = [];
  // Đơn đặt trước lấy trước.
  for (const d of [...dongDon].sort((a, b) => a.ngayDat.localeCompare(b.ngayDat) || a.maDon.localeCompare(b.maDon))) {
    if (!d.sku) { khong.push({ ...d, lyDo: 'thiếu SKU' }); continue; }
    const k = khoaSku(d.sku); const lo = k ? kho.get(k) : undefined;
    if (!lo) { khong.push({ ...d, lyDo: 'không có SKU trong PO' }); continue; }
    const duocPhep = lo.filter((l) => l.period <= d.thangDat);
    if (duocPhep.length === 0) { khong.push({ ...d, lyDo: 'chưa có PO trước tháng đặt' }); continue; }
    let can = d.qty; const tu: PhanBo['tuPO'] = [];
    for (const l of duocPhep) { if (can <= 0) break; if (l.conLai <= 0) continue; const lay = Math.min(l.conLai, can); l.conLai -= lay; can -= lay; tu.push({ refCode: l.refCode, period: l.period, qty: lay, donGiaVnd: Math.round(l.donGia) }); }
    if (tu.length === 0) { khong.push({ ...d, lyDo: 'PO hết số lượng' }); continue; }
    if (can > 0) { // lấy được một phần: hoàn lại để không ghi giá vốn thiếu chiếc — báo ops
      for (const t of tu) { const l = duocPhep.find((x) => x.refCode === t.refCode)!; l.conLai += t.qty; }
      khong.push({ ...d, lyDo: 'PO hết số lượng' }); continue;
    }
    phanBo.push({ orderId: d.orderId, shopifyLineId: d.shopifyLineId, maDon: d.maDon, sku: d.sku, thangDat: d.thangDat, amountVnd: Math.round(tu.reduce((s, t) => s + t.qty * t.donGiaVnd, 0)), tuPO: tu });
  }
  return { phanBo, khong };
}
