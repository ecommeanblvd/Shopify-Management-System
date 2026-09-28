import { describe, expect, it } from 'vitest';
import { kyThang, viecGom } from './ky-bang-ke';

describe('kyThang', () => {
  it('giữa tháng → đầu và cuối tháng đó', () => {
    expect(kyThang(new Date('2026-09-28T10:00:00Z'))).toEqual({ dau: '2026-09-01', cuoi: '2026-09-30', ten: '2026-09' });
  });

  it('tháng 31 ngày', () => {
    expect(kyThang(new Date('2026-08-15T00:00:00Z')).cuoi).toBe('2026-08-31');
  });

  it('tháng 2 năm nhuận', () => {
    expect(kyThang(new Date('2028-02-10T00:00:00Z')).cuoi).toBe('2028-02-29');
  });

  it('BIÊN NGÀY VN: 23:00 UTC ngày 30/09 đã là 01/10 giờ VN → kỳ tháng 10', () => {
    expect(kyThang(new Date('2026-09-30T23:00:00Z')).ten).toBe('2026-10');
  });

  it('BIÊN NGÀY VN: 16:00 UTC ngày 30/09 vẫn là 30/09 giờ VN → kỳ tháng 9', () => {
    expect(kyThang(new Date('2026-09-30T16:00:00Z')).ten).toBe('2026-09');
  });
});

describe('viecGom', () => {
  it('chưa có bảng kê → tạo mới', () => expect(viecGom(null)).toBe('tao_moi'));
  it('đang nháp → gom thêm vào đúng bản nháp đó, KHÔNG tạo bản thứ hai', () =>
    expect(viecGom('draft')).toBe('them_vao_nhap'));
  it('đã phát hành → bỏ qua, số đã gửi brand phải đứng yên', () => {
    expect(viecGom('issued')).toBe('bo_qua_da_chot');
    expect(viecGom('paid')).toBe('bo_qua_da_chot');
  });
});
