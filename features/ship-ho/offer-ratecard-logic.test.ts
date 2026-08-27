import { describe, it, expect } from 'vitest';
import { buildRateCard, type RateCardSnapshot } from './offer-ratecard-logic';

const ASOF = new Date('2026-07-05T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');

function surcharge(over: Partial<RateCardSnapshot['surcharges'][number]> & { kind: string }): RateCardSnapshot['surcharges'][number] {
  return {
    value: 0,
    active: true,
    valuePerKg: null,
    tier: null,
    countryCodes: null,
    startsAt: null,
    endsAt: null,
    ...over,
  };
}

function snap(): RateCardSnapshot {
  const zoneA = { label: 'Zone A', rateByTierUpper: new Map([[0.5, 100000], [1, 180000]]) };
  const zoneB = { label: 'Zone B', rateByTierUpper: new Map([[0.5, 120000], [1, 200000]]) };
  return {
    costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000,
    weightTiers: [{ upperKg: 0.5 }, { upperKg: 1 }],
    zonesByCountry: new Map([['US', zoneA], ['CA', zoneA], ['GB', zoneB]]),
    surcharges: [
      surcharge({ kind: 'fuel_percent', value: 38.25 }),
      surcharge({ kind: 'remote_fixed', value: 550000, valuePerKg: 9200, tier: 'Tier B' }),
    ],
  };
}

describe('buildRateCard — bảng giá + zone (không đổi hành vi cũ)', () => {
  it('tiers tăng dần, gồm mọi upperKg', () => {
    const c = buildRateCard(snap(), 30, ASOF);
    expect(c.tiers).toEqual([0.5, 1]);
  });
  it('gom zone distinct theo label + danh sách nước', () => {
    const c = buildRateCard(snap(), 30, ASOF);
    const zoneA = c.zones.find((z) => z.label === 'Zone A')!;
    expect(zoneA.countries.sort()).toEqual(['CA', 'US']);
    expect(c.zones).toHaveLength(2);
  });
  it('offer = round(baseVnd × (1+markup))', () => {
    const c = buildRateCard(snap(), 30, ASOF);
    const zoneA = c.zones.find((z) => z.label === 'Zone A')!;
    const cell05 = zoneA.cells.find((x) => x.tierUpperKg === 0.5)!;
    expect(cell05.baseVnd).toBe(100000);
    expect(cell05.offerVnd).toBe(130000);
  });
  it('displayCurrency VND → base chia fx', () => {
    const s = snap();
    s.costCurrency = 'USD'; s.displayCurrency = 'VND'; s.fxCostPerDisplay = 0.25;
    const c = buildRateCard(s, 30, ASOF);
    const cell = c.zones.find((z) => z.label === 'Zone A')!.cells.find((x) => x.tierUpperKg === 0.5)!;
    expect(cell.baseVnd).toBe(400000);
    expect(cell.offerVnd).toBe(520000);
  });
});

describe('buildRateCard — countryZones (bảng zone quốc gia kiểu carrier)', () => {
  it('map code→name đúng (VN có trong lib/geo/countries) + sort theo tên', () => {
    const s = snap();
    s.zonesByCountry.set('VN', { label: 'Zone VN', rateByTierUpper: new Map() });
    const c = buildRateCard(s, 30, ASOF);
    const vnRow = c.countryZones.find((cz) => cz.code === 'VN')!;
    expect(vnRow.name).toBe('Việt Nam');
    expect(vnRow.zone).toBe('Zone VN');
    // sort theo name (localeCompare) — kiểm tra mảng đã sort đúng thứ tự alphabet.
    const names = c.countryZones.map((cz) => cz.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
  it('mỗi nước 1 dòng — số dòng bằng số key trong zonesByCountry', () => {
    const c = buildRateCard(snap(), 30, ASOF);
    expect(c.countryZones).toHaveLength(3); // US, CA, GB
    expect(c.countryZones.find((cz) => cz.code === 'US')?.zone).toBe('Zone A');
    expect(c.countryZones.find((cz) => cz.code === 'GB')?.zone).toBe('Zone B');
  });
});

describe('buildRateCard — surcharges (chi phí cụ thể + công thức, chỉ active)', () => {
  it('dòng HẾT HẠN (endsAt quá khứ) KHÔNG xuất hiện', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'vat_percent', value: 8, endsAt: PAST }));
    const c = buildRateCard(s, 30, ASOF);
    expect(c.surcharges.find((x) => x.label === 'VAT')).toBeUndefined();
  });
  it('dòng CHƯA BẮT ĐẦU (startsAt tương lai) KHÔNG xuất hiện', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'vat_percent', value: 8, startsAt: FUTURE }));
    const c = buildRateCard(s, 30, ASOF);
    expect(c.surcharges.find((x) => x.label === 'VAT')).toBeUndefined();
  });
  it('dòng active=false KHÔNG xuất hiện', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'vat_percent', value: 8, active: false }));
    const c = buildRateCard(s, 30, ASOF);
    expect(c.surcharges.find((x) => x.label === 'VAT')).toBeUndefined();
  });
  it('markup_percent & packaging_fixed bị loại (nội bộ, không phải phụ phí khách)', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'markup_percent', value: 30 }));
    s.surcharges.push(surcharge({ kind: 'packaging_fixed', value: 15000 }));
    const c = buildRateCard(s, 30, ASOF);
    expect(c.surcharges.some((x) => x.detail.includes('30'))).toBe(false);
    expect(c.surcharges.some((x) => x.detail.includes('15.000'))).toBe(false);
  });
  it('LUÔN có dòng "Phí xử lý đơn hàng" = 50.000₫, không chú "(chưa VAT)", nằm TRÊN dòng VAT', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'vat_percent', value: 8 }));
    const c = buildRateCard(s, 30, ASOF);
    const proc = c.surcharges.find((x) => x.kind === 'processing_fixed');
    expect(proc).toEqual({ kind: 'processing_fixed', label: 'Phí xử lý đơn hàng', detail: '50.000₫' });
    expect(proc!.detail).not.toMatch(/VAT|chưa|\(/);
    const procIdx = c.surcharges.findIndex((x) => x.kind === 'processing_fixed');
    const vatIdx = c.surcharges.findIndex((x) => x.kind === 'vat_percent');
    expect(procIdx).toBeLessThan(vatIdx);
  });
  it('Phí xử lý xuất hiện KỂ CẢ khi không có phụ phí carrier nào', () => {
    const s = snap();
    s.surcharges = [];
    const c = buildRateCard(s, 30, ASOF);
    expect(c.surcharges.some((x) => x.kind === 'processing_fixed')).toBe(true);
  });
  it('fuel_percent: KHÔNG xuất hiện trong surcharges (chỉ hiển thị link fuel FedEx trên UI)', () => {
    const c = buildRateCard(snap(), 30, ASOF);
    expect(c.surcharges.some((x) => x.kind === 'fuel_percent')).toBe(false);
    expect(c.surcharges.find((x) => x.label === 'Phụ phí xăng dầu (FedEx, theo tuần)')).toBeUndefined();
  });
  it('remote_fixed 3 tier gộp 1 dòng đúng công thức max()', () => {
    const s = snap();
    s.surcharges = [
      surcharge({ kind: 'remote_fixed', value: 350000, tier: 'Tier A' }),
      surcharge({ kind: 'remote_fixed', value: 550000, valuePerKg: 9200, tier: 'Tier B' }),
      surcharge({ kind: 'remote_fixed', value: 750000, valuePerKg: 12500, tier: 'Tier C' }),
    ];
    const c = buildRateCard(s, 30, ASOF);
    const remote = c.surcharges.find((x) => x.label.includes('vùng xa'));
    expect(remote).toBeDefined();
    expect(remote!.detail).toBe(
      'Tier A: 350.000₫/lô · Tier B: max(550.000₫/lô, 9.200₫/kg) · Tier C: max(750.000₫/lô, 12.500₫/kg)',
    );
  });
  it('ODA Tier B value=550000 valuePerKg=9200 → "max(550.000₫/lô, 9.200₫/kg)"', () => {
    const c = buildRateCard(snap(), 30, ASOF);
    const remote = c.surcharges.find((x) => x.label.includes('vùng xa'));
    expect(remote!.detail).toContain('max(550.000₫/lô, 9.200₫/kg)');
  });
  it('demand_per_kg gộp distinct value (nhiều mức)', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'demand_per_kg', value: 28400 }));
    s.surcharges.push(surcharge({ kind: 'demand_per_kg', value: 39700 }));
    s.surcharges.push(surcharge({ kind: 'demand_per_kg', value: 28400 })); // trùng — phải distinct
    const c = buildRateCard(s, 30, ASOF);
    const demand = c.surcharges.find((x) => x.label.includes('Demand'));
    expect(demand?.detail).toBe('28.400₫/kg · 39.700₫/kg (tùy khu vực đích)');
  });
  it('demand_per_kg 1 mức duy nhất → không có hậu tố "(tùy khu vực đích)"', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'demand_per_kg', value: 28400 }));
    const c = buildRateCard(s, 30, ASOF);
    const demand = c.surcharges.find((x) => x.label.includes('Demand'));
    expect(demand?.detail).toBe('28.400₫/kg');
  });
  it('residential_fixed: value + (nếu countryCodes) danh sách áp dụng', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'residential_fixed', value: 82200 }));
    s.surcharges.push(surcharge({ kind: 'residential_fixed', value: 50000, countryCodes: ['US', 'CA'] }));
    const c = buildRateCard(s, 30, ASOF);
    const rows = c.surcharges.filter((x) => x.label === 'Phụ phí địa chỉ dân cư');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.detail === '82.200₫/lô')).toBeDefined();
    expect(rows.find((r) => r.detail === '50.000₫/lô (áp dụng: US, CA)')).toBeDefined();
  });
  it('country_fixed: value + danh sách áp dụng', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'country_fixed', value: 120000, countryCodes: ['VN'] }));
    const c = buildRateCard(s, 30, ASOF);
    const row = c.surcharges.find((x) => x.label === 'Phí xử lý theo nước');
    expect(row?.detail).toBe('120.000₫/lô (áp dụng: VN)');
  });
  it('addon_fixed không có ghi chú: giữ nhãn mặc định Direct Signature', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'addon_fixed', value: 45000 }));
    const c = buildRateCard(s, 30, ASOF);
    const row = c.surcharges.find((x) => x.label.includes('Direct Signature'));
    expect(row?.detail).toBe('45.000₫/lô');
  });

  // Aramex dùng addon_fixed cho phí hải quan đầu xuất; gắn cứng nhãn "ký nhận
  // trực tiếp" là ghi sai tên khoản phí trên bảng giá gửi đối tác.
  it('addon_fixed có ghi chú: lấy ghi chú làm tên khoản phí', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'addon_fixed', value: 10524, note: 'Phí hải quan đầu xuất', applyMode: 'always' }));
    const c = buildRateCard(s, 30, ASOF);
    const row = c.surcharges.find((x) => x.kind === 'addon_fixed');
    expect(row?.label).toBe('Phí hải quan đầu xuất');
    expect(row?.detail).toBe('10.524₫/lô');
  });

  it('khoản chỉ tính khi phát sinh thì ghi rõ "khi chọn"', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'addon_fixed', value: 21060, note: 'Phí sai địa chỉ', applyMode: 'when_billed' }));
    const c = buildRateCard(s, 30, ASOF);
    const row = c.surcharges.find((x) => x.kind === 'addon_fixed');
    expect(row?.label).toBe('Phí sai địa chỉ (khi phát sinh)');
  });
  it('vat_percent: "{value}%"', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'vat_percent', value: 8 }));
    const c = buildRateCard(s, 30, ASOF);
    const row = c.surcharges.find((x) => x.label === 'VAT');
    expect(row?.detail).toBe('8%');
  });
  it('kind lạ không rơi vào case nào → bỏ qua, không vỡ', () => {
    const s = snap();
    s.surcharges.push(surcharge({ kind: 'per_step_fixed', value: 1000 }));
    s.surcharges.push(surcharge({ kind: 'contract_discount_pct', value: 5 }));
    expect(() => buildRateCard(s, 30, ASOF)).not.toThrow();
  });
});

describe('buildRateCard — zone theo dải bưu chính (Zone K = CN Hoa Nam)', () => {
  const zoneK = { label: 'Zone K', rateByTierUpper: new Map([[0.5, 542003], [1, 581174]]) };
  const withK = (): RateCardSnapshot => ({
    ...snap(),
    zonePostcodeRanges: [
      { countryCode: 'CN', rangeStart: 350000, rangeEnd: 369999, zone: zoneK },
      { countryCode: 'CN', rangeStart: 510000, rangeEnd: 529999, zone: zoneK },
    ],
  });
  it('Zone K xuất hiện trên card với mô tả dải bưu chính + cells đúng markup', () => {
    const c = buildRateCard(withK(), 8, ASOF);
    const k = c.zones.find((z) => z.label === 'Zone K')!;
    expect(k).toBeTruthy();
    expect(k.countries).toEqual(['CN 350000–369999', 'CN 510000–529999']);
    expect(k.cells.find((x) => x.tierUpperKg === 0.5)!.offerVnd).toBe(Math.round(542003 * 1.08));
  });
  it('không có ranges → card y như cũ (không Zone K)', () => {
    const c = buildRateCard(snap(), 8, ASOF);
    expect(c.zones.find((z) => z.label === 'Zone K')).toBeUndefined();
  });
});
