import { describe, it, expect } from 'vitest';
import { maChiec, maPhieuNhan } from './nhan-logic';

describe('maChiec', () => {
  it('dựng mã chiếc theo năm-tháng giờ kinh doanh + số thứ tự 5 chữ số', () => {
    expect(maChiec(7, new Date('2026-09-23T10:00:00Z'))).toBe('WH-2609-00007');
  });
  it('ranh tháng theo giờ kinh doanh: 00:00 ngày 1/10 VN = 17:00 ngày 30/9 UTC → tháng 10', () => {
    expect(maChiec(8, new Date('2026-09-30T17:00:00Z'))).toBe('WH-2610-00008');
  });
  it('số vượt 5 chữ số thì KHÔNG cắt, để mã vẫn duy nhất', () => {
    expect(maChiec(123456, new Date('2026-09-23T10:00:00Z'))).toBe('WH-2609-123456');
  });
  it('số không hợp lệ thì ném', () => {
    expect(() => maChiec(0, new Date('2026-09-23T10:00:00Z'))).toThrow();
    expect(() => maChiec(1.5, new Date('2026-09-23T10:00:00Z'))).toThrow();
    expect(() => maChiec(-1, new Date('2026-09-23T10:00:00Z'))).toThrow();
  });
});

describe('maPhieuNhan', () => {
  it('gom theo kho + ngày + brand', () => {
    expect(maPhieuNhan('2026-09-24', 'HA THANH VIET', 'GVM')).toBe('WH-GVM-2026-09-24-HA-THANH-VIET');
  });
  it('brand trống vẫn có phiếu riêng, không trộn vào brand khác', () => {
    expect(maPhieuNhan('2026-09-24', null, 'GVM')).toBe('WH-GVM-2026-09-24-KHONG-BRAND');
    expect(maPhieuNhan('2026-09-24', '   ', 'GVM')).toBe('WH-GVM-2026-09-24-KHONG-BRAND');
  });
  it('cùng kho cùng ngày cùng brand ra CÙNG mã — để chiếc gom về một phiếu', () => {
    expect(maPhieuNhan('2026-09-24', 'Larmes', 'AP')).toBe(maPhieuNhan('2026-09-24', 'larmes', 'AP'));
  });
  it('HAI KHO cùng nhận một brand trong một ngày ra HAI phiếu khác nhau', () => {
    expect(maPhieuNhan('2026-09-24', 'Larmes', 'GVM')).not.toBe(maPhieuNhan('2026-09-24', 'Larmes', 'AP'));
  });
});
