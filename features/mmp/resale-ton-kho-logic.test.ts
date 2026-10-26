import { describe, expect, it } from 'vitest';
import { LOAI_RESALE, laLoaiResale, phanLoFifo, type LoNhap, type TonHienTai } from './resale-ton-kho-logic';

const lo = (sku: string, kho: string, ngay: string, sl: number, loai: string): LoNhap =>
  ({ sku, kho, ngayNhapKho: ngay, soLuong: sl, loaiTon: loai });
const ton = (sku: string, kho: string, onHand: number, reserved = 0): TonHienTai =>
  ({ sku, kho, qtyOnHand: onHand, qtyReserved: reserved });

describe('laLoaiResale — chỉ hàng MEAN đã MUA ĐỨT', () => {
  /* CEO chốt 26/10/2026. Consignment là KÝ GỬI — brand vẫn sở hữu, nên đẩy nó sang màn
   * Resale là để nhân sự giảm giá và bán hàng MEAN CHƯA MUA. Đây là rủi ro với brand,
   * không phải lỗi kỹ thuật, nên nó phải là một hằng khai tường minh và có test. */
  it('nhận đúng 5 loại đã chốt', () => {
    expect([...LOAI_RESALE].sort()).toEqual([
      'Tồn kho (Cancel/ Sai địa chỉ)', 'Tồn kho (MEAN Design)', 'Tồn kho (PO)',
      'Tồn kho (Return)', 'Tồn kho TQ',
    ]);
  });

  it('LOẠI Consignment — brand vẫn sở hữu', () => {
    expect(laLoaiResale('Tồn kho (Consignment)')).toBe(false);
  });

  it('loại các nhóm không phải hàng bán', () => {
    for (const v of ['Đồ lỗi (k bán)', 'CompGift', 'Mượn Vendor/ Sample - k theo order',
                     'Mượn Vendor - KOL', 'VTĐG1', 'VTĐG2', 'Retail', null, undefined, '']) {
      expect(laLoaiResale(v)).toBe(false);
    }
  });

  it('nhận 5 loại resale', () => {
    for (const v of [...LOAI_RESALE]) expect(laLoaiResale(v)).toBe(true);
  });
});

describe('phanLoFifo — chia tồn hiện tại vào các lô, CŨ TRƯỚC', () => {
  /* Vì sao FIFO chạy trên MỌI lô rồi mới lọc resale, chứ không chỉ chạy trên lô resale:
   * tồn hiện tại của một (sku,kho) là HỖN HỢP mọi loại. Nếu chỉ FIFO trên lô resale thì
   * tồn của hàng ký gửi bị gán sai thành resale. Kho thật xuất cũ-trước bất kể loại, nên
   * tiêu thụ theo đúng thứ tự đó rồi giữ lại phần rơi vào lô resale mới là trung thực. */
  it('một lô, vừa đủ', () => {
    const r = phanLoFifo([ton('A', 'GVM', 5)], [lo('A', 'GVM', '2026-01-05', 5, 'Tồn kho (PO)')]);
    expect(r).toEqual([{ sku: 'A', kho: 'GVM', ngayNhapKho: '2026-01-05', soLuong: 5, loaiTon: 'Tồn kho (PO)' }]);
  });

  it('nhiều lô: tiêu thụ CŨ TRƯỚC, lô mới bị cắt', () => {
    const r = phanLoFifo([ton('A', 'GVM', 7)], [
      lo('A', 'GVM', '2026-03-01', 10, 'Tồn kho (PO)'),
      lo('A', 'GVM', '2026-01-05', 5, 'Tồn kho (PO)'),
    ]);
    expect(r).toEqual([
      { sku: 'A', kho: 'GVM', ngayNhapKho: '2026-01-05', soLuong: 5, loaiTon: 'Tồn kho (PO)' },
      { sku: 'A', kho: 'GVM', ngayNhapKho: '2026-03-01', soLuong: 2, loaiTon: 'Tồn kho (PO)' },
    ]);
  });

  /** Đây là ca quan trọng nhất: lô ký gửi CŨ HƠN ăn hết tồn, nên không còn gì là resale. */
  it('lô Consignment cũ hơn tiêu thụ trước ⇒ resale còn ít hoặc hết', () => {
    const r = phanLoFifo([ton('A', 'GVM', 3)], [
      lo('A', 'GVM', '2026-01-01', 4, 'Tồn kho (Consignment)'),
      lo('A', 'GVM', '2026-05-01', 4, 'Tồn kho (PO)'),
    ]);
    expect(r).toEqual([]);
  });

  it('tồn vượt phần ký gửi thì phần dư rơi vào lô resale', () => {
    const r = phanLoFifo([ton('A', 'GVM', 6)], [
      lo('A', 'GVM', '2026-01-01', 4, 'Tồn kho (Consignment)'),
      lo('A', 'GVM', '2026-05-01', 4, 'Tồn kho (PO)'),
    ]);
    expect(r).toEqual([{ sku: 'A', kho: 'GVM', ngayNhapKho: '2026-05-01', soLuong: 2, loaiTon: 'Tồn kho (PO)' }]);
  });

  /** `qty_reserved` là hàng ĐÃ HỨA cho đơn chưa đóng — không được mời bán lại. */
  it('trừ qty_reserved: chỉ gửi phần CÒN BÁN ĐƯỢC', () => {
    const r = phanLoFifo([ton('A', 'GVM', 5, 2)], [lo('A', 'GVM', '2026-01-05', 5, 'Tồn kho (PO)')]);
    expect(r).toEqual([{ sku: 'A', kho: 'GVM', ngayNhapKho: '2026-01-05', soLuong: 3, loaiTon: 'Tồn kho (PO)' }]);
  });

  it('reserved giữ hết thì không gửi dòng nào', () => {
    expect(phanLoFifo([ton('A', 'GVM', 2, 2)], [lo('A', 'GVM', '2026-01-05', 2, 'Tồn kho (PO)')])).toEqual([]);
  });

  /* Tồn nhiều hơn tổng lô ghi nhận: KHÔNG bịa lô, chỉ gửi phần truy được. Thà thiếu một
   * dòng còn hơn gửi một ngày nhập không có căn cứ — spec dùng ngày đó để quyết giảm giá. */
  it('tồn nhiều hơn tổng các lô ⇒ chỉ gửi phần có lô, không bịa', () => {
    const r = phanLoFifo([ton('A', 'GVM', 9)], [lo('A', 'GVM', '2026-01-05', 2, 'Tồn kho (PO)')]);
    expect(r).toEqual([{ sku: 'A', kho: 'GVM', ngayNhapKho: '2026-01-05', soLuong: 2, loaiTon: 'Tồn kho (PO)' }]);
  });

  it('tồn 0 hoặc không có lô ⇒ không dòng nào', () => {
    expect(phanLoFifo([ton('A', 'GVM', 0)], [lo('A', 'GVM', '2026-01-05', 5, 'Tồn kho (PO)')])).toEqual([]);
    expect(phanLoFifo([ton('B', 'GVM', 5)], [lo('A', 'GVM', '2026-01-05', 5, 'Tồn kho (PO)')])).toEqual([]);
  });

  /** Tồn tách theo (sku, KHO) nên lô của kho khác KHÔNG được dùng cho kho này. */
  it('không trộn kho', () => {
    const r = phanLoFifo([ton('A', 'GVM', 3)], [lo('A', 'AP', '2026-01-05', 3, 'Tồn kho (PO)')]);
    expect(r).toEqual([]);
  });

  it('gộp nhiều lô CÙNG ngày cùng loại thành một dòng', () => {
    const r = phanLoFifo([ton('A', 'GVM', 4)], [
      lo('A', 'GVM', '2026-01-05', 2, 'Tồn kho (PO)'),
      lo('A', 'GVM', '2026-01-05', 3, 'Tồn kho (PO)'),
    ]);
    expect(r).toEqual([{ sku: 'A', kho: 'GVM', ngayNhapKho: '2026-01-05', soLuong: 4, loaiTon: 'Tồn kho (PO)' }]);
  });
});
