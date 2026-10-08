import { describe, expect, it } from 'vitest';
import { canBangMienThu, NHAN_MIEN_THU, type KhoanPhiMmp } from './bang-ke-khoan-phi';

const phi: KhoanPhiMmp[] = [
  { code: 'base', label: 'Cước cơ bản', amountVnd: 1_062_301 },
  { code: 'fuel', label: 'Phụ phí xăng dầu', amountVnd: 540_191, percent: 46.5 },
  { code: 'demand', label: 'Phụ phí nhu cầu', amountVnd: 99_400 },
  { code: 'vat', label: 'VAT', amountVnd: 140_151 },
  { code: 'processing', label: 'Phí xử lý đơn hàng', amountVnd: 50_000 },
];
const TONG = 1_892_043;

describe('canBangMienThu', () => {
  /* #KLS2053 lần gửi sai địa chỉ: phí THẬT vẫn phát sinh, thu brand 0đ. MMP ràng
     Σ fees = amountVnd và trả 422 nếu lệch, nên phải có dòng âm bù đúng bằng tổng phí. */
  it('đơn miễn thu được thêm dòng waived âm, tổng về 0', () => {
    const r = canBangMienThu(phi, TONG, 0);
    expect(r.feesTotalVnd).toBe(0);
    const w = r.fees.at(-1)!;
    expect(w.code).toBe('waived');
    expect(w.label).toBe(NHAN_MIEN_THU);
    expect(w.amountVnd).toBe(-TONG);
    expect(r.fees.reduce((s, f) => s + f.amountVnd, 0)).toBe(0);
  });

  it('giữ nguyên phân rã phí gốc, chỉ THÊM một dòng', () => {
    const r = canBangMienThu(phi, TONG, 0);
    expect(r.fees.slice(0, phi.length)).toEqual(phi);
    expect(r.fees).toHaveLength(phi.length + 1);
  });

  it('đơn thu bình thường thì không đụng gì', () => {
    const r = canBangMienThu(phi, TONG, TONG);
    expect(r.fees).toEqual(phi);
    expect(r.feesTotalVnd).toBe(TONG);
  });

  /* Lệch mà KHÔNG phải ca miễn thu thì để nguyên cho MMP trả 422: bù im lặng là làm sổ MMP
     khớp giả còn bên mình mất tín hiệu có lỗi. */
  it('lệch kiểu khác KHÔNG tự bù', () => {
    const r = canBangMienThu(phi, TONG, 1_000_000);
    expect(r.fees).toEqual(phi);
    expect(r.feesTotalVnd).toBe(TONG);
  });

  /* MMP yêu cầu waived ≤ 0 — không bao giờ sinh dòng dương. */
  it('phí bằng 0 thì không sinh dòng waived', () => {
    expect(canBangMienThu([], 0, 0).fees).toEqual([]);
  });

  it('không sinh dòng waived dương dù phí âm', () => {
    const am: KhoanPhiMmp[] = [
      { code: 'weight_adjust', label: 'Điều chỉnh khớp số đã ghi', amountVnd: -5000 },
    ];
    expect(canBangMienThu(am, -5000, 0).fees).toEqual(am);
  });
});
