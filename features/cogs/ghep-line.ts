/** THUẦN: luật ghép dòng bảng kê brand vào line đơn Shopify (spec §4). Không đoán: mơ hồ → không ghi. */
import type { DongBangKe } from './doc-bang-ke';

export interface LineDon { orderId: string; storeId: string; shopifyLineId: string; sku: string | null; quantity: number; variantTitle: string | null }
export interface DonTraCuu { orderId: string; storeId: string; maDon: string; lines: LineDon[] }

export function chuanHoaMaDon(s: string): string { return s.replace(/\s+/g, '').replace(/^#/, '').toUpperCase(); }
/** Mã không thuộc đơn Shopify của MEAN → ghi bảng offline: PO/MTB (MEAN mua đứt Denio), #HC… (đơn store riêng
 *  Happy Clothing Global), #MXHS… (đơn sàn XiaoHongShu, Trung Quốc — CEO 08/09). */
/** Thêm 08/09 (Maison des Copains): "#PO-001" (PO mua đứt, cách ghi khác), "#OS007"/"#MOS10011" (đơn ngoài Shopify — chờ CEO xác nhận kênh). */
/** Mã KHÔNG phải đơn Shopify MEAN: PO (#MBLVDPO, #MTB, #PO-001), store brand (#HC), XiaoHongShu (#MXHS), Off Store (#OS/#MOS), #CSM… cũng là đơn Off Store (LaMai T8/2026 ghi Note "đơn offstore"; Nhat Vy T6/2026 #CSM009). */
export function laMaNgoaiShopify(maDon: string): boolean { return /^MBLVDPO/i.test(maDon) || /^MTB/i.test(maDon) || /^HC\d/i.test(maDon) || /^MXHS\d/i.test(maDon) || /^PO-?\d/i.test(maDon) || /^M?OS\d/i.test(maDon) || /^CSM\d/i.test(maDon); }

/** Token mã sản phẩm: bỏ tiền tố brand, tách theo '+', bỏ tiền tố 'PK' khi sau nó còn mã chữ+số (PKDN0729 → DN0729);
 * PK0729 (không mã chữ) giữ nguyên → ['DN0729','PK0729'…]. Giữ thứ tự, bỏ trùng. */
export function maGoc(sku: string): string[] {
  const phan = sku.split('-').slice(1);            // bỏ 'Denio'
  const out: string[] = [];
  for (const p of phan) for (const t of p.split('+')) {
    const m = /^(PK)?([A-Z]{2,}\d{3,})$/i.exec(t.trim());
    if (m) { const k = m[2].toUpperCase(); if (!out.includes(k)) out.push(k); }
  }
  return out;
}
/** Token size/màu: mọi phần sau mã gốc (S, M, CRE, BLA…). */
function tokenKhac(sku: string): Set<string> {
  const goc = new Set(maGoc(sku).flatMap((g) => [g, `PK${g}`]));
  return new Set(sku.split(/[-+]/).slice(1).map((t) => t.trim().toUpperCase()).filter((t) => t && !goc.has(t)));
}

export type LyDoKhongKhop = 'khong_co_don' | 'khong_co_line_khop' | 'mo_ho';
export interface KetQuaGhep {
  theoLine: Array<{ line: LineDon; dong: DongBangKe[]; amount: number; slSheet: number; du: boolean; cachKhop: 'sku' | 'ma_goc' | 'don_mot_line' }>;
  offline: DongBangKe[];
  khongKhop: Array<{ dong: DongBangKe; lyDo: LyDoKhongKhop }>;
}

function chonLine(dong: DongBangKe, lines: LineDon[], daGan: (l: LineDon) => number = () => 0): { line: LineDon; cach: 'sku' | 'ma_goc' | 'don_mot_line' } | 'mo_ho' | null {
  const sku = dong.sku.trim().toUpperCase();
  const dung = lines.filter((l) => (l.sku ?? '').trim().toUpperCase() === sku);
  if (dung.length === 1) return { line: dung[0], cach: 'sku' };
  if (dung.length > 1) {
    // Đơn có NHIỀU line cùng một SKU (khách mua 2 chiếc giống nhau, Shopify tách 2 line): các line
    // hoán đổi được cho nhau nên gán tuần tự — line còn chỗ (số dòng sheet đã gán < quantity) lấy trước;
    // đủ hết thì line đầu (sẽ báo "dư"). Không phải mơ hồ vì kết quả tiền như nhau dù chọn line nào.
    // (Calista #MBLVD26692, 08/09/2026.) SKU khác nhau mà cùng khớp → vẫn mơ hồ.
    return { line: dung.find((l) => daGan(l) < l.quantity) ?? dung[0], cach: 'sku' };
  }
  const goc = maGoc(dong.sku);
  let soUngVien = 0;
  if (goc.length) {
    let ungVien = lines.filter((l) => { const g = maGoc(l.sku ?? ''); return goc.some((x) => g.includes(x)); });
    soUngVien = ungVien.length;
    if (ungVien.length > 1) {
      const tk = tokenKhac(dong.sku);
      const hop = ungVien.filter((l) => [...tk].every((t) => tokenKhac(l.sku ?? '').has(t)));
      if (hop.length >= 1) ungVien = hop;
    }
    if (ungVien.length === 1) return { line: ungVien[0], cach: 'ma_goc' };
    if (ungVien.length > 1) return 'mo_ho';
  }
  if (lines.length === 1) return { line: lines[0], cach: 'don_mot_line' };
  if (lines.length === 0) return null;
  return soUngVien > 1 ? 'mo_ho' : null;
}

export function ghepBangKe(dongs: DongBangKe[], don: Map<string, DonTraCuu>): KetQuaGhep {
  const kq: KetQuaGhep = { theoLine: [], offline: [], khongKhop: [] };
  const gom = new Map<string, KetQuaGhep['theoLine'][number]>();
  for (const dg of dongs) {
    const ma = chuanHoaMaDon(dg.maDon);
    if (laMaNgoaiShopify(ma)) { kq.offline.push(dg); continue; }
    const d = don.get(ma);
    if (!d) { kq.khongKhop.push({ dong: dg, lyDo: 'khong_co_don' }); continue; }
    const c = chonLine(dg, d.lines, (l) => gom.get(`${d.orderId}|${l.shopifyLineId}`)?.slSheet ?? 0);
    if (c === null) { kq.khongKhop.push({ dong: dg, lyDo: 'khong_co_line_khop' }); continue; }
    if (c === 'mo_ho') { kq.khongKhop.push({ dong: dg, lyDo: 'mo_ho' }); continue; }
    const k = `${d.orderId}|${c.line.shopifyLineId}`;
    const cur = gom.get(k) ?? { line: c.line, dong: [], amount: 0, slSheet: 0, du: false, cachKhop: c.cach };
    cur.dong.push(dg); cur.amount += dg.tt; cur.slSheet += dg.sl; cur.du = cur.slSheet > c.line.quantity;
    // Nhóm nhiều dòng: chỉ giữ 'sku' khi MỌI dòng khớp SKU đúng — không nói quá độ tin cậy.
    if (c.cach !== 'sku') cur.cachKhop = c.cach;
    gom.set(k, cur);
  }
  kq.theoLine = [...gom.values()];
  return kq;
}
