/**
 * THUẦN: PO nào / món nào còn được nhập (CEO 29/09/2026).
 *
 * Ba điều kiện CEO chốt:
 *  1. CHỈ dòng đã tick "Báo đơn" trên Lark;
 *  2. gom theo `Order Number` — PO nào đã nhập ĐỦ thì KHÔNG cho chọn thêm món nào
 *     nữa, kể cả món lẻ trong PO đó còn thiếu;
 *  3. PO còn thiếu thì chỉ hiện đúng món còn thiếu.
 *
 * Điều 2 là điều dễ làm sai nhất: nếu chỉ xét từng món thì một PO đã nhận đủ
 * tổng nhưng lệch giữa các size (nhận thừa size M, thiếu size S) vẫn mở cửa cho
 * nhận tiếp — trong khi thực tế lô đó đã về xong. CEO chặn ở mức ĐƠN.
 *
 * "Đã nhận" cộng HAI nguồn (CEO chốt): dòng đội kho nhập tay trên bảng Lark, và
 * chiếc vừa nhận trên SMS. Bắt buộc phải cộng cả hai vì lệnh đẩy sang Lark đang
 * TẮT — chỉ đếm Lark thì chiếc vừa nhận trên SMS không trừ vào số còn lại và kho
 * sẽ nhận thừa.
 */

export interface DongPo {
  recordId: string;
  orderNumber: string | null;
  sku: string | null;
  soLuong: number;
  baoDon: boolean;
}

/** Số đã nhận theo khoá `đơn|sku`, gộp sẵn từ cả hai nguồn. */
export type DaNhan = ReadonlyMap<string, number>;

export const khoa = (don: string | null, sku: string | null): string =>
  `${(don ?? '').trim()}|${(sku ?? '').trim()}`;

export interface MonPoConNhan {
  recordId: string;
  orderNumber: string;
  sku: string;
  dat: number;
  daNhan: number;
  con: number;
}

/** Gom dòng PO đã tick theo (đơn, sku) — một PO có thể có nhiều dòng cùng SKU. */
function gom(ds: readonly DongPo[]): Map<string, { don: string; sku: string; dat: number; recordId: string }> {
  const m = new Map<string, { don: string; sku: string; dat: number; recordId: string }>();
  for (const d of ds) {
    if (!d.baoDon) continue;
    const don = d.orderNumber?.trim(), sku = d.sku?.trim();
    if (!don || !sku) continue;          // thiếu khoá thì không đối chiếu được
    const k = khoa(don, sku);
    const g = m.get(k);
    if (g) g.dat += d.soLuong;
    else m.set(k, { don, sku, dat: d.soLuong, recordId: d.recordId });
  }
  return m;
}

/** THUẦN: các ĐƠN PO đã nhập đủ — không cho chọn thêm món nào. */
export function donDaDu(ds: readonly DongPo[], daNhan: DaNhan): Set<string> {
  const theoDon = new Map<string, { dat: number; nhan: number }>();
  for (const [k, g] of gom(ds)) {
    const t = theoDon.get(g.don) ?? { dat: 0, nhan: 0 };
    t.dat += g.dat;
    // Nhận THỪA một món không bù cho món thiếu ở món khác — chặn trên từng món
    // rồi mới cộng, nếu không một PO lệch size sẽ trông như đã đủ.
    t.nhan += Math.min(daNhan.get(k) ?? 0, g.dat);
    theoDon.set(g.don, t);
  }
  const du = new Set<string>();
  for (const [don, t] of theoDon) if (t.dat > 0 && t.nhan >= t.dat) du.add(don);
  return du;
}

/** THUẦN: món PO còn nhập được, đã loại đơn đã đủ. */
export function monPoConNhan(ds: readonly DongPo[], daNhan: DaNhan): MonPoConNhan[] {
  const du = donDaDu(ds, daNhan);
  const ra: MonPoConNhan[] = [];
  for (const [k, g] of gom(ds)) {
    if (du.has(g.don)) continue;
    const da = daNhan.get(k) ?? 0;
    if (da >= g.dat) continue;
    ra.push({ recordId: g.recordId, orderNumber: g.don, sku: g.sku, dat: g.dat, daNhan: da, con: g.dat - da });
  }
  return ra.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber) || a.sku.localeCompare(b.sku));
}
