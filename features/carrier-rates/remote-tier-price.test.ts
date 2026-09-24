import { describe, it, expect } from 'vitest';
import { timTierThieuGia, type DongPhuPhi, type TierCoMa } from './remote-tier-price';

const LUC = new Date('2026-09-24T00:00:00Z');

const pp = (tier: string | null, o: Partial<DongPhuPhi> = {}): DongPhuPhi =>
  ({ kind: 'remote_fixed', tier, active: true, startsAt: null, endsAt: null, ...o });

describe('timTierThieuGia', () => {
  it('UPS sau khi nạp EAS: ba tier có mã mà chưa có giá', () => {
    const tiers: TierCoMa[] = [
      { tier: 'Extended', soDong: 41_178 },
      { tier: 'Remote', soDong: 10_182 },
      { tier: 'Phụ phí Khu vực Phát hàng - Mở rộng', soDong: 7869 },
      { tier: 'Phụ phí Khu vực Phát hàng', soDong: 5719 },
      { tier: 'Phụ phí Vùng sâu vùng xa - Mở rộng', soDong: 3763 },
    ];
    const thieu = timTierThieuGia(tiers, [pp('Extended'), pp('Remote')], LUC);
    expect(thieu.map((t) => t.tier)).toEqual([
      'Phụ phí Khu vực Phát hàng - Mở rộng',
      'Phụ phí Khu vực Phát hàng',
      'Phụ phí Vùng sâu vùng xa - Mở rộng',
    ]);
    // Xếp theo số dòng giảm dần — chỗ mất tiền nhiều nhất lên trên.
    expect(thieu[0].soDong).toBe(7869);
  });

  it('DHL: một dòng CHUNG (tier null) phủ mọi lần khớp → không kêu', () => {
    expect(timTierThieuGia([{ tier: null, soDong: 645_567 }], [pp(null)], LUC)).toEqual([]);
  });

  it('dòng chung phủ cả tier có nhãn', () => {
    expect(timTierThieuGia([{ tier: 'Bất kỳ', soDong: 10 }], [pp(null)], LUC)).toEqual([]);
  });

  it('FedEx: Tier A/B/C đều có giá → không kêu', () => {
    const tiers: TierCoMa[] = [
      { tier: 'Tier A', soDong: 100 }, { tier: 'Tier B', soDong: 100 }, { tier: 'Tier C', soDong: 100 },
    ];
    expect(timTierThieuGia(tiers, [pp('Tier A'), pp('Tier B'), pp('Tier C')], LUC)).toEqual([]);
  });

  it('mã KHÔNG phân bậc mà không có dòng chung → vẫn kêu (engine cộng 0)', () => {
    expect(timTierThieuGia([{ tier: null, soDong: 5 }], [pp('Tier A')], LUC))
      .toEqual([{ tier: null, soDong: 5 }]);
  });

  it('dòng phụ phí đã tắt không tính là có giá', () => {
    expect(timTierThieuGia([{ tier: 'Remote', soDong: 5 }], [pp('Remote', { active: false })], LUC))
      .toHaveLength(1);
  });

  it('dòng phụ phí HẾT HẠN không tính là có giá', () => {
    const hetHan = pp('Remote', { endsAt: new Date('2026-01-01T00:00:00Z') });
    expect(timTierThieuGia([{ tier: 'Remote', soDong: 5 }], [hetHan], LUC)).toHaveLength(1);
  });

  it('dòng phụ phí CHƯA hiệu lực không tính là có giá', () => {
    const chuaToi = pp('Remote', { startsAt: new Date('2027-01-01T00:00:00Z') });
    expect(timTierThieuGia([{ tier: 'Remote', soDong: 5 }], [chuaToi], LUC)).toHaveLength(1);
  });

  it('kind khác remote_fixed không được tính là giá vùng xa', () => {
    expect(timTierThieuGia([{ tier: 'Remote', soDong: 5 }], [pp('Remote', { kind: 'peak_fixed' })], LUC))
      .toHaveLength(1);
  });

  it('tier 0 dòng thì không kêu', () => {
    expect(timTierThieuGia([{ tier: 'Remote', soDong: 0 }], [], LUC)).toEqual([]);
  });

  it('tài khoản chưa có mã bưu chính nào → không kêu', () => {
    expect(timTierThieuGia([], [], LUC)).toEqual([]);
  });
});
