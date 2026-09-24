import { describe, it, expect } from 'vitest';
import { matchRemoteTier } from './remote-match';
import type { DaiMaBuuChinh } from './remote-range';

describe('matchRemoteTier', () => {
  it('undefined map → null', () => {
    expect(matchRemoteTier(undefined, '90210', 'X')).toEqual({ tier: null, matchedBy: null });
  });

  it('postcode khớp raw (ưu tiên trước city)', () => {
    const m = new Map<string, string | null>([['90210', 'Tier A'], ['BEVERLYHILLS', 'Tier B']]);
    expect(matchRemoteTier(m, '90210', 'Beverly Hills')).toEqual({ tier: 'Tier A', matchedBy: 'postcode' });
  });

  it('postcode khớp sau strip (ZIP+4 → base)', () => {
    // stored as '90210', input as '90210-1234' → stripped prefix matches
    const m = new Map<string, string | null>([['90210', 'Tier A']]);
    expect(matchRemoteTier(m, '90210-1234', 'Beverly Hills')).toEqual({ tier: 'Tier A', matchedBy: 'postcode' });
  });

  it('city fallback khi postcode miss', () => {
    const m = new Map<string, string | null>([['JEDDAH', 'Tier C']]);
    expect(matchRemoteTier(m, '00000', 'Jeddah')).toMatchObject({ matchedBy: 'city' });
  });

  it('wildcard country-default', () => {
    const m = new Map<string, string | null>([['*', 'Tier D']]);
    expect(matchRemoteTier(m, 'zzz', 'Nowhere')).toEqual({ tier: 'Tier D', matchedBy: 'country_default' });
  });

  it('miss hoàn toàn → null', () => {
    expect(matchRemoteTier(new Map(), '123', 'Y')).toEqual({ tier: null, matchedBy: null });
  });

  it('null postcode + null city → country-default khi có wildcard', () => {
    const m = new Map<string, string | null>([['*', 'Tier E']]);
    expect(matchRemoteTier(m, null, null)).toEqual({ tier: 'Tier E', matchedBy: 'country_default' });
  });

  it('tier null (no-tier row) trả về đúng', () => {
    // tier stored as null means remote but no tier label
    const m = new Map<string, string | null>([['12345', null]]);
    expect(matchRemoteTier(m, '12345', 'City')).toEqual({ tier: null, matchedBy: 'postcode' });
  });
});

describe('matchRemoteTier + dải mã bưu chính', () => {
  const dai = (batDau: string, ketThuc: string, tier: string | null): DaiMaBuuChinh =>
    ({ batDau, ketThuc, doDai: batDau.length, tier });

  it('KHÔNG truyền dải → hành vi y hệt như trước (DHL/FedEx không đổi)', () => {
    const m = new Map<string, string | null>([['12345', 'Tier A']]);
    expect(matchRemoteTier(m, '12345', null)).toEqual({ tier: 'Tier A', matchedBy: 'postcode' });
    expect(matchRemoteTier(m, '99999', null)).toEqual({ tier: null, matchedBy: null });
  });

  it('dải khớp khi không có dòng mã chính xác nào', () => {
    const ds = [dai('07001', '07099', 'Phụ phí Khu vực Phát hàng')];
    expect(matchRemoteTier(new Map(), '07050', null, ds))
      .toEqual({ tier: 'Phụ phí Khu vực Phát hàng', matchedBy: 'postcode_range' });
  });

  it('LUẬT: mã CHÍNH XÁC thắng DẢI, kể cả khi dải cho tier đắt hơn', () => {
    const m = new Map<string, string | null>([['07050', 'Extended']]);
    const ds = [dai('07001', '07099', 'Remote')];
    expect(matchRemoteTier(m, '07050', null, ds)).toEqual({ tier: 'Extended', matchedBy: 'postcode' });
  });

  it('LUẬT: dải thắng TÊN THÀNH PHỐ — mã vẫn cụ thể hơn tên', () => {
    const m = new Map<string, string | null>([['NEWARK', 'Extended']]);
    const ds = [dai('07001', '07099', 'Remote')];
    expect(matchRemoteTier(m, '07050', 'Newark', ds)).toEqual({ tier: 'Remote', matchedBy: 'postcode_range' });
  });

  it('dải trượt thì vẫn rơi xuống city rồi wildcard như cũ', () => {
    const m = new Map<string, string | null>([['NEWARK', 'Extended']]);
    const ds = [dai('07001', '07099', 'Remote')];
    expect(matchRemoteTier(m, '99999', 'Newark', ds)).toMatchObject({ matchedBy: 'city' });
    const w = new Map<string, string | null>([['*', 'Tier D']]);
    expect(matchRemoteTier(w, '99999', 'Nowhere', ds)).toMatchObject({ matchedBy: 'country_default' });
  });

  it('nước chỉ được mô tả bằng dải (không có map mã chính xác)', () => {
    const ds = [dai('000000', '999999', 'Phụ phí Khu vực mở rộng')];
    expect(matchRemoteTier(undefined, '123456', null, ds))
      .toEqual({ tier: 'Phụ phí Khu vực mở rộng', matchedBy: 'postcode_range' });
    expect(matchRemoteTier(undefined, null, 'Luanda', ds)).toEqual({ tier: null, matchedBy: null });
  });

  it('ZIP+4 khớp dải 5 ký tự', () => {
    const ds = [dai('98070', '98079', 'Remote')];
    expect(matchRemoteTier(new Map(), '98077-5629', null, ds))
      .toEqual({ tier: 'Remote', matchedBy: 'postcode_range' });
  });
});
