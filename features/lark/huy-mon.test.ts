import { describe, it, expect } from 'vitest';
import { docMonLark, laGiaTriHuy, tinhTrangHuyKien, type MonLark } from './huy-mon';

const mon = (o: Partial<MonLark>): MonLark => ({
  dinhDanh: 'dd', recordId: 'rec', orderNumber: 'MBLVD1', sku: null, lineitemName: null, store: null, vendor: null, huy: false, lyDo: null, ...o,
});

describe('laGiaTriHuy', () => {
  it('nhận mọi giá trị chứa cancel, không phân biệt hoa thường', () => {
    expect(laGiaTriHuy('Cancel packing')).toBe(true);
    expect(laGiaTriHuy('Cancel - SOLD OUT by Vendor')).toBe(true);
    expect(laGiaTriHuy('Packed')).toBe(false);
    expect(laGiaTriHuy(null)).toBe(false);
  });
});

describe('docMonLark', () => {
  it('đọc món bị huỷ ở cột điều phối kho', () => {
    const m = docMonLark({
      'Định danh': '#MBLVD29309-Larmes-LAR1612-L-RED-PDL-21184',
      order_number: '#MBLVD29309',
      'Lineitem SKU': 'Larmes-LAR1612-L-RED',
      'WH-Điều phối đơn': 'Cancel packing',
      'PROCU - Final Order Stt': 'MEAN đã báo Brand',
    }, 'rec29309');
    expect(m).toEqual({
      dinhDanh: '#MBLVD29309-Larmes-LAR1612-L-RED-PDL-21184',
      recordId: 'rec29309',
      orderNumber: 'MBLVD29309',
      sku: 'Larmes-LAR1612-L-RED',
      lineitemName: null,
      store: null,
      vendor: null,
      huy: true,
      lyDo: 'Cancel packing',
    });
  });

  it('huỷ từ mua hàng cũng tính', () => {
    const m = docMonLark({ 'Định danh': 'x', order_number: 'TA1', 'PROCU - Final Order Stt': 'Cancel - SOLD OUT by Vendor' }, 'rec1');
    expect(m?.huy).toBe(true);
    expect(m?.lyDo).toBe('Cancel - SOLD OUT by Vendor');
  });

  it('món bình thường và dòng thiếu định danh', () => {
    expect(docMonLark({ 'Định danh': 'x', order_number: 'TA1', 'WH-Điều phối đơn': 'Packed' }, 'rec1')?.huy).toBe(false);
    expect(docMonLark({ order_number: 'TA1' }, 'rec1')).toBeNull();
  });
});

describe('docMonLark mang đủ thông tin tạo dòng kho', () => {
  it('đọc record id, tên hàng, store, vendor', () => {
    const m = docMonLark({
      'Định danh': '#MBLVD30426-Tracy-V1416-XS-WBRM-PLA-PDL-1',
      order_number: '#MBLVD30426',
      'Lineitem SKU': 'Tracy-V1416-XS-WBRM-PLA',
      'Lineitem name': 'Vianne Straight Across Maxi Dress - Buttercream',
      Store: '#MBLVD',
      vendor: 'TRACY STUDIO',
    }, 'recABC');
    expect(m).toMatchObject({
      recordId: 'recABC',
      lineitemName: 'Vianne Straight Across Maxi Dress - Buttercream',
      store: '#MBLVD',
      vendor: 'TRACY STUDIO',
    });
  });
  it('thiếu record id vẫn đọc được (dòng cũ), chỉ không tạo link được', () => {
    const m = docMonLark({ 'Định danh': 'x', order_number: 'TA1' }, '');
    expect(m?.recordId).toBe('');
  });
});

describe('tinhTrangHuyKien', () => {
  it('cả đơn huỷ → kiện không đi hàng', () => {
    const r = tinhTrangHuyKien('A-1', [mon({ sku: 'A-1', huy: true, lyDo: 'Cancel packing' })]);
    expect(r).toEqual({ loai: 'toan_bo', soHuy: 1, tong: 1, lyDo: 'Cancel packing' });
  });

  it('đơn nhiều món, kiện chỉ chứa món ĐÃ HUỶ → kiện đó bỏ', () => {
    const r = tinhTrangHuyKien('A-1', [mon({ sku: 'A-1', huy: true, lyDo: 'Cancel packing' }), mon({ sku: 'B-2' })]);
    expect(r.loai).toBe('toan_bo');
  });

  it('đơn nhiều món, kiện chứa món CÒN ĐI → kiện vẫn đi, không cảnh báo nhầm', () => {
    const r = tinhTrangHuyKien('B-2', [mon({ sku: 'A-1', huy: true }), mon({ sku: 'B-2' })]);
    expect(r.loai).toBe('khong');
    expect(r.soHuy).toBe(1);
  });

  it('kiện gồm cả món huỷ lẫn món còn đi → cảnh báo một phần', () => {
    const r = tinhTrangHuyKien('A-1, B-2', [mon({ sku: 'A-1', huy: true }), mon({ sku: 'B-2' })]);
    expect(r.loai).toBe('mot_phan');
  });

  it('kiện không ghi SKU → chỉ kết luận khi cả đơn huỷ, còn lại là cảnh báo', () => {
    expect(tinhTrangHuyKien(null, [mon({ huy: true }), mon({})]).loai).toBe('mot_phan');
    expect(tinhTrangHuyKien(null, [mon({ huy: true })]).loai).toBe('toan_bo');
  });

  it('không món nào huỷ, hoặc chưa có dữ liệu món → không cảnh báo', () => {
    expect(tinhTrangHuyKien('A-1', [mon({ sku: 'A-1' })]).loai).toBe('khong');
    expect(tinhTrangHuyKien('A-1', []).loai).toBe('khong');
  });
});
