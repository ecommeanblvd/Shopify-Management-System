import { describe, expect, it } from 'vitest';
import { kyThang, viecGom, kyTuTen, kyTiepTheo, chonKyGom } from './ky-bang-ke';

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

describe('kyTuTen', () => {
  it('dựng kỳ từ tên YYYY-MM, ngày cuối đúng cả tháng 2 nhuận', () => {
    expect(kyTuTen('2026-09')).toEqual({ dau: '2026-09-01', cuoi: '2026-09-30', ten: '2026-09' });
    expect(kyTuTen('2026-02').cuoi).toBe('2026-02-28');
    expect(kyTuTen('2028-02').cuoi).toBe('2028-02-29');
    expect(kyTuTen('2026-12').cuoi).toBe('2026-12-31');
  });

  /* Tên lạ phải NÉM, không được im lặng trả một kỳ nào đó: hàm này quyết tiền vào kỳ nào. */
  it('tên lạ → ném lỗi, không đoán', () => {
    expect(() => kyTuTen('2026-13')).toThrow();
    expect(() => kyTuTen('2026-00')).toThrow();
    expect(() => kyTuTen('09-2026')).toThrow();
    expect(() => kyTuTen('')).toThrow();
  });
});

describe('kyTiepTheo', () => {
  it('sang tháng sau, qua năm thì tăng năm', () => {
    expect(kyTiepTheo('2026-09')).toBe('2026-10');
    expect(kyTiepTheo('2026-12')).toBe('2027-01');
  });
});

describe('chonKyGom', () => {
  const khong = () => null;

  it('kỳ của mốc còn mở → xếp ĐÚNG kỳ đó, không phải tháng đang chạy', () => {
    expect(chonKyGom({ tenMoc: '2026-07', tenHienTai: '2026-10', trangThai: khong }))
      .toEqual({ ten: '2026-07', ly: 'dung_moc' });
  });

  it('kỳ của mốc còn NHÁP → vẫn xếp vào đó (gom thêm vào bản nháp)', () => {
    expect(chonKyGom({ tenMoc: '2026-09', tenHienTai: '2026-10', trangThai: () => 'draft' }))
      .toEqual({ ten: '2026-09', ly: 'dung_moc' });
  });

  /* Số đã gửi brand phải đứng yên — nhưng đơn KHÔNG được kẹt lại (D-130), nó đi tới kỳ
     đang mở sớm nhất, đúng cách assignBillingPeriod bên MMP làm. */
  it('kỳ của mốc đã chốt → nhảy tới KỲ ĐANG MỞ SỚM NHẤT, không phải tháng đang chạy', () => {
    const tt = (ten: string) => (ten === '2026-07' || ten === '2026-08' ? 'issued' : null);
    expect(chonKyGom({ tenMoc: '2026-07', tenHienTai: '2026-10', trangThai: tt }))
      .toEqual({ ten: '2026-09', ly: 'ky_moc_da_chot' });
  });

  it('paid cũng là đã chốt', () => {
    const tt = (ten: string) => (ten === '2026-08' ? 'paid' : null);
    expect(chonKyGom({ tenMoc: '2026-08', tenHienTai: '2026-09', trangThai: tt }))
      .toEqual({ ten: '2026-09', ly: 'ky_moc_da_chot' });
  });

  it('mọi kỳ tới nay đều chốt → KHÔNG xếp, chờ kỳ sau mở', () => {
    expect(chonKyGom({ tenMoc: '2026-08', tenHienTai: '2026-09', trangThai: () => 'issued' }))
      .toEqual({ ten: null, ly: 'khong_con_ky_mo' });
  });

  it('mốc ở tương lai → KHÔNG xếp, báo riêng (lỗi đồng hồ/dữ liệu phải nhìn thấy)', () => {
    expect(chonKyGom({ tenMoc: '2026-11', tenHienTai: '2026-10', trangThai: khong }))
      .toEqual({ ten: null, ly: 'moc_tuong_lai' });
  });

  it('mốc đúng kỳ đang chạy và kỳ đó chưa có kê → tạo mới ở chính kỳ đó', () => {
    expect(chonKyGom({ tenMoc: '2026-10', tenHienTai: '2026-10', trangThai: khong }))
      .toEqual({ ten: '2026-10', ly: 'dung_moc' });
  });
});
