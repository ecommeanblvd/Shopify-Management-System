import { describe, it, expect } from 'vitest';
import { dungPatch, type KienGhiNguoc, type ChargeGhiNguoc } from './dung-patch';
import { COT, COT_CHI_PHI } from './cot';
import { ngayLark, ngayDuKien } from './ngay-lark';

const kien = (p: Partial<KienGhiNguoc> = {}): KienGhiNguoc => ({
  deliveryStatus: 'in_transit', deliverySource: 'fedex', deliveredAt: null,
  labelCreatedAt: new Date('2026-09-10T00:00:00Z'), shipCountry: 'US', ...p,
});
const charge = (p: Partial<ChargeGhiNguoc> = {}): ChargeGhiNguoc => ({
  totalAmount: 1438453, base: 2244600, discount: -1541142, fuel: 383043, remote: 0, demand: 0,
  directSignature: 92700, vat: 106552, gogreen: 0, elevatedRisk: 0, importHandling: 68300, residential: 84400,
  addressCorrection: 0, ...p,
});

describe('dungPatch — nguồn (cổng chỉ áp cho trạng thái + ngày giao thực tế)', () => {
  it('nguồn lark → KHÔNG ghi ô chọn và Ngày giao thực tế, nhưng vẫn điền chi phí + ngày dự kiến trống', () => {
    const r = dungPatch(kien({ deliverySource: 'lark', deliveryStatus: 'delivered', deliveredAt: new Date('2026-09-15T08:00:00Z') }), charge(), {});
    expect(COT.category in r.patch).toBe(false);
    expect(COT.status in r.patch).toBe(false);
    expect(COT.ngayGiaoThucTe in r.patch).toBe(false);
    expect(r.patch[COT.ngayGiaoDuKien]).toBe(ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'US'));
    expect(r.patch[COT_CHI_PHI.totalAmount]).toBe(1438453);
    expect(r.nhom).toEqual({ trangThai: 0, ngay: 1, chiPhi: 7 });
    expect(r.lech).toEqual([]);
  });
  it('nguồn null → như nguồn lark', () => {
    const r = dungPatch(kien({ deliverySource: null }), charge(), {});
    expect(COT.category in r.patch).toBe(false);
    expect(r.nhom.chiPhi).toBe(7);
  });
  it('nguồn lark, ô chi phí đã có số khác → vẫn ghi lệch (không ghi đè)', () => {
    const r = dungPatch(kien({ deliverySource: 'lark' }), charge(), { [COT_CHI_PHI.totalAmount]: 1 });
    expect(COT_CHI_PHI.totalAmount in r.patch).toBe(false);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.totalAmount))).toHaveLength(1);
  });
});

describe('dungPatch — trạng thái (ghi đè)', () => {
  it('ô trống → ghi cả hai ô chọn', () => {
    const r = dungPatch(kien(), null, {});
    expect(r.patch[COT.category]).toBe('In Transit');
    expect(r.patch[COT.status]).toBe('On Delivery');
    expect(r.nhom.trangThai).toBe(2);
    expect(r.lech).toEqual([]);
  });
  it('Ops gõ khác → vẫn ghi đè + một mục lệch mỗi ô', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: new Date('2026-09-15T08:00:00Z') }), null,
      { [COT.category]: 'In Transit', [COT.status]: 'On Delivery' });
    expect(r.patch[COT.category]).toBe('Delivered');
    expect(r.patch[COT.status]).toBe('Delivery Completed');
    expect(r.lech.filter((l) => l.includes(COT.category))).toHaveLength(1);
    expect(r.lech.filter((l) => l.includes(COT.status))).toHaveLength(1);
  });
  it('ô đã đúng → không nằm trong patch', () => {
    const r = dungPatch(kien(), null, { [COT.category]: 'In Transit', [COT.status]: 'On Delivery' });
    expect(COT.category in r.patch).toBe(false);
    expect(COT.status in r.patch).toBe(false);
    expect(r.nhom.trangThai).toBe(0);
  });
  it('trạng thái unknown → không ghi ô chọn', () => {
    const r = dungPatch(kien({ deliveryStatus: 'unknown' }), null, {});
    expect(COT.category in r.patch).toBe(false);
  });
});

describe('dungPatch — ngày', () => {
  const giao = new Date('2026-09-15T08:00:00Z');
  it('delivered + có ngày → ghi Ngày giao thực tế dạng epoch nửa đêm VN', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, {});
    expect(r.patch[COT.ngayGiaoThucTe]).toBe(ngayLark(giao));
    expect(r.nhom.ngay).toBeGreaterThanOrEqual(1);
  });
  it('in_transit → không ghi Ngày giao thực tế', () => {
    expect(COT.ngayGiaoThucTe in dungPatch(kien(), null, {}).patch).toBe(false);
  });
  it('Ngày giao thực tế Ops gõ khác → ghi đè + lệch; trùng ngày → bỏ qua', () => {
    const r = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, { [COT.ngayGiaoThucTe]: ngayLark(new Date('2026-09-14T08:00:00Z')) });
    expect(r.patch[COT.ngayGiaoThucTe]).toBe(ngayLark(giao));
    expect(r.lech.some((l) => l.includes(COT.ngayGiaoThucTe))).toBe(true);
    const r2 = dungPatch(kien({ deliveryStatus: 'delivered', deliveredAt: giao }), null, { [COT.ngayGiaoThucTe]: ngayLark(giao) });
    expect(COT.ngayGiaoThucTe in r2.patch).toBe(false);
  });
  it('Ngày giao dự kiến: trống → label + SLA; đã có → giữ nguyên, không lệch', () => {
    const r = dungPatch(kien(), null, {});
    expect(r.patch[COT.ngayGiaoDuKien]).toBe(ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'US'));
    const r2 = dungPatch(kien(), null, { [COT.ngayGiaoDuKien]: 1 });
    expect(COT.ngayGiaoDuKien in r2.patch).toBe(false);
    expect(r2.lech).toEqual([]);
  });
  it('thiếu label hoặc nước → không ghi dự kiến', () => {
    expect(COT.ngayGiaoDuKien in dungPatch(kien({ labelCreatedAt: null }), null, {}).patch).toBe(false);
    expect(COT.ngayGiaoDuKien in dungPatch(kien({ shipCountry: null }), null, {}).patch).toBe(false);
  });
});

describe('dungPatch — chi phí (chỉ điền ô trống)', () => {
  it('ô trống → điền tổng + mọi khoản > 0, bỏ khoản 0', () => {
    const r = dungPatch(kien(), charge(), {});
    expect(r.patch[COT_CHI_PHI.totalAmount]).toBe(1438453);
    expect(r.patch[COT_CHI_PHI.fuel]).toBe(383043);
    expect(r.patch[COT_CHI_PHI.directSignature]).toBe(92700);
    expect(r.patch[COT_CHI_PHI.vat]).toBe(106552);
    expect(r.patch[COT_CHI_PHI.importHandling]).toBe(68300);
    expect(r.patch[COT_CHI_PHI.residential]).toBe(84400);
    expect(COT_CHI_PHI.remote in r.patch).toBe(false);
    expect(COT_CHI_PHI.demand in r.patch).toBe(false);
    expect(COT_CHI_PHI.gogreen in r.patch).toBe(false);
    expect(r.nhom.chiPhi).toBe(7);
  });
  it('Mức giá cơ sở theo QUY_UOC_BASE', () => {
    const r = dungPatch(kien(), charge(), {});
    // Task 1 chốt quy ước; test canh cả hai nhánh để ai đổi hằng số phải nhìn thấy.
    expect([2244600, 2244600 - 1541142]).toContain(r.patch[COT_CHI_PHI.base]);
  });
  it('ô đã có số → không ghi; khác thì lệch', () => {
    const r = dungPatch(kien(), charge(), { [COT_CHI_PHI.totalAmount]: 1400000, [COT_CHI_PHI.fuel]: 383043 });
    expect(COT_CHI_PHI.totalAmount in r.patch).toBe(false);
    expect(COT_CHI_PHI.fuel in r.patch).toBe(false);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.totalAmount))).toHaveLength(1);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.fuel))).toHaveLength(0);
  });
  it('total_amount = 0 hoặc không có charge → không ghi khoản nào', () => {
    const r = dungPatch(kien(), charge({ totalAmount: 0 }), {});
    const tenCotChiPhi: readonly string[] = Object.values(COT_CHI_PHI);
    expect(Object.keys(r.patch).some((k) => tenCotChiPhi.includes(k))).toBe(false);
    expect(dungPatch(kien(), null, {}).nhom.chiPhi).toBe(0);
  });
  it('sai lệch làm tròn ≤ 1đ coi như bằng', () => {
    const r = dungPatch(kien(), charge(), { [COT_CHI_PHI.totalAmount]: 1438453.4 });
    expect(r.lech).toEqual([]);
  });
});

/* ═════ Ô `Phí sửa địa chỉ` — đường HOÁ ĐƠN (fldx5cOZJu, type=2, ghi được) ═════
 *
 * Khoản Address Correction phát sinh SAU khi hãng giao hụt vì địa chỉ sai, nên BÁO GIÁ lúc tạo
 * vận đơn không thể biết (đo 13/10/2026: `ADDRESS_CORRECTION` 0/1.310 phản hồi FedEx Rate API
 * còn lưu trữ) ⇒ đường GIÁ ƯỚC TÍNH để ô này trống là đúng. HOÁ ĐƠN thì CÓ số thật:
 * `shipment_charges.address_correction` 63/6.027 dòng. Trước hôm nay khoản đó không vào Lark
 * bằng đường nào cả — `chargeTu` chưa SELECT cột, nên `khoan['addressCorrection']` là
 * `undefined` và vòng lặp bỏ qua ô y như khi hãng không thu.
 *
 * Nhóm test này khoá lại ba điều, theo đúng luật đang có của `dungPatch` (KHÔNG nới):
 * điền khi trống · không đụng khi đã có số · bỏ qua khi `<= 0` hoặc `null`. */
describe('dungPatch — Phí sửa địa chỉ (đường hoá đơn)', () => {
  it('ô trống + hoá đơn có số → điền ô `Phí sửa địa chỉ`, và đếm vào nhóm chi phí', () => {
    const r = dungPatch(kien(), charge({ addressCorrection: 289_200 }), {});
    expect(r.patch[COT_CHI_PHI.addressCorrection]).toBe(289_200);
    // 7 khoản của `charge()` mặc định + khoản mới ⇒ 8. Con số này bắt luôn ca ghi CHỒNG:
    // nếu khoá `addressCorrection` bị trỏ trùng tên cột với một khoản khác thì `patch` chỉ có
    // 7 ô mà `chiPhi` vẫn 8 — lệch ngay.
    expect(r.nhom.chiPhi).toBe(8);
    expect(Object.values(COT_CHI_PHI).filter((c) => c in r.patch)).toHaveLength(8);
    expect(r.lech).toEqual([]);
  });
  it('ô ĐÃ CÓ số khác → KHÔNG ghi đè, chỉ nêu lệch để người đọc nhật ký đi xem', () => {
    // Lark chỉ cho điền thêm, không có undo — đè một ô là số Ops gõ mất vĩnh viễn (D-045).
    const r = dungPatch(kien(), charge({ addressCorrection: 289_200 }),
      { [COT_CHI_PHI.addressCorrection]: 150_000 });
    expect(COT_CHI_PHI.addressCorrection in r.patch).toBe(false);
    expect(r.lech.filter((l) => l.includes(COT_CHI_PHI.addressCorrection))).toHaveLength(1);
  });
  it('khoản `null` hoặc `<= 0` → ô VẮNG khỏi bản vá, không ghi `0`', () => {
    // Ghi `0` là khoá ô ở 0 VĨNH VIỄN: lượt sau `docSo` đọc ra `0 ≠ null` tức "ĐÃ CÓ", nên
    // số hoá đơn thật về sau không bao giờ điền được vào nữa. 0 không phải "chưa biết".
    for (const v of [null, 0, -289_200]) {
      const r = dungPatch(kien(), charge({ addressCorrection: v }), {});
      expect(COT_CHI_PHI.addressCorrection in r.patch, `addressCorrection = ${v}`).toBe(false);
    }
  });
  it('ô có dữ liệu không đọc được thành số (vd `"289,200"`) → coi là CÓ, không chạm', () => {
    // `docSo('289,200')` ra `null`; nếu lấy đó làm lá chắn thì ô này bị coi là trống ⇒ ĐÈ.
    // `oLarkTrong` mới là lá chắn: "không phân tích được" nghĩa là CÓ, đừng chạm.
    const r = dungPatch(kien(), charge({ addressCorrection: 289_200 }),
      { [COT_CHI_PHI.addressCorrection]: '289,200' });
    expect(COT_CHI_PHI.addressCorrection in r.patch).toBe(false);
    expect(r.lech.some((l) => l.includes(COT_CHI_PHI.addressCorrection))).toBe(true);
  });

  /* ───── KHOÁ TÊN CỘT TỪNG BYTE ─────
   * Lark ghi theo TÊN cột và PUT là all-or-nothing ⇒ lệch MỘT dấu tiếng Việt là **cả bản vá bị
   * từ chối**, kể cả những ô chẳng liên quan. Tên này vừa bị CEO đổi một lần (`Phí Address
   * Correction` → `Phí sửa địa chỉ`, cùng `field_id` `fldx5cOZJu`) nên khả năng đổi lần nữa là
   * có thật. Đọc lại nguyên văn qua API fields 14/10/2026: type=2, 15 ký tự, 23 byte UTF-8.
   *
   * Khẳng định NFC riêng vì dạng TỔ HỢP (`i` + U+0301 thay vì `í` U+00ED) nhìn GIỐNG Y HỆT trên
   * màn hình: `toBe` vẫn đỏ nhưng người đọc sẽ không hiểu vì sao. Đây là test đối xứng với test
   * cùng tên ở `patch-gia-uoc-tinh.test.ts` — hai đường ghi dùng CHUNG một khoá, nên đường nào
   * cũng phải có lá chắn, ai sửa `cot.ts` cũng thấy đỏ. */
  it('tên cột "Phí sửa địa chỉ" đúng từng byte (NFC, 23 byte UTF-8)', () => {
    const ten = COT_CHI_PHI.addressCorrection;
    expect(ten).toBe('Phí sửa địa chỉ');
    expect(ten).toBe(ten.normalize('NFC'));
    expect(Buffer.from(ten, 'utf8')).toHaveLength(23);
    expect([...ten]).toHaveLength(15);
    /* Tên CŨ đã chết — ai dán lại nó là bản vá bị Lark từ chối toàn bộ. */
    expect(ten).not.toBe('Phí Address Correction');
  });
});
