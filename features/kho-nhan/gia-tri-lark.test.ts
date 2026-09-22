import { describe, it, expect } from 'vitest';
import { cotTaoDong, cotCapNhat, QC_CHECK, WH_ACTION, WAREHOUSE, type ViecNhanKcs } from './gia-tri-lark';

const viec: ViecNhanKcs = {
  monDinhDanh: '#MBLVD30426-Tracy-PDL-1', monRecordId: 'recMON', orderNumber: '#MBLVD30426',
  sku: 'Tracy-V1416-XS-WBRM-PLA', lineitemName: 'Vianne Maxi Dress', store: '#MBLVD', vendor: 'TRACY STUDIO',
  soLuong: 1, canKg: 1.5, qcCheck: 'QC Pass', whAction: 'Tạm nhập (đi đơn)', lyDoFail: null, warehouse: 'HN | GVM',
};

describe('cotTaoDong', () => {
  it('đủ 13 cột kho đang dùng, ngày là epoch nửa đêm giờ VN', () => {
    const c = cotTaoDong(viec, new Date('2026-09-22T05:00:00Z'));
    expect(c).toEqual({
      'Import (select order)': ['recMON'],
      'Lineitem SKU final': 'Tracy-V1416-XS-WBRM-PLA',
      'Lineitem Name': 'Vianne Maxi Dress',
      'Order Number final': '#MBLVD30426',
      'Store final': '#MBLVD',
      'Vendor final': 'TRACY STUDIO',
      Warehouse: 'HN | GVM',
      'Import - Inventory type': 'Retail',
      'Ngày Import - tiếp nhận đồ tại kho': Date.UTC(2026, 8, 22),
      'Quantity tiếp nhận trước QC': 1,
      'Weight (kg)': 1.5,
      'QC Check': 'QC Pass',
      'WH - Action': 'Tạm nhập (đi đơn)',
    });
  });

  it('không đạt → thêm lý do; thiếu record món thì bỏ link chứ không gửi rỗng', () => {
    const c = cotTaoDong({ ...viec, qcCheck: 'QC Failed', whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bung chỉ', monRecordId: null }, new Date('2026-09-22T05:00:00Z'));
    expect(c['Lý do QC failed']).toBe('bung chỉ');
    expect('Import (select order)' in c).toBe(false);
  });

  it('không có cân thì bỏ cột cân, không gửi 0', () => {
    expect('Weight (kg)' in cotTaoDong({ ...viec, canKg: null }, new Date())).toBe(false);
  });
});

describe('cotCapNhat', () => {
  it('CHỈ 5 cột, không đụng cột định danh của dòng cũ', () => {
    expect(Object.keys(cotCapNhat(viec)).sort()).toEqual(
      ['QC Check', 'Quantity tiếp nhận trước QC', 'WH - Action', 'Weight (kg)'].sort(),
    );
    expect(cotCapNhat({ ...viec, qcCheck: 'QC Failed', lyDoFail: 'bẩn' })['Lý do QC failed']).toBe('bẩn');
  });
});

describe('danh sách giá trị', () => {
  it('khớp đúng tên đang có trên Lark, không đặt tên mới', () => {
    expect(QC_CHECK).toEqual(['QC Pass', 'QC Failed', 'Gửi dư']);
    expect(WH_ACTION[0]).toBe('Tạm nhập (đi đơn)');
    expect(WH_ACTION).toContain('Gửi trả Vendor (QC fail)');
    expect(WAREHOUSE).toContain('HN | GVM');
  });
});
