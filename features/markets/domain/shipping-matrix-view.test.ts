import { describe, it, expect } from 'vitest';
import { flattenShippingMatrix, carriersInZones, buildZoneWeightMatrix, parseRateSearch, bracketMatchesWeight, buildMarketCodes, zoneCarrierLabel, applyZoneCodes, summarizeZoneCountries } from './shipping-matrix-view';
import type { MarketShipping } from '../types';

const ship = (zones: MarketShipping['zones']): MarketShipping => ({ zones });

describe('flattenShippingMatrix', () => {
  it('null/rỗng → []', () => {
    expect(flattenShippingMatrix(null)).toEqual([]);
    expect(flattenShippingMatrix(ship({}))).toEqual([]);
  });
  it('rate sắp theo cận trên kg', () => {
    const z = flattenShippingMatrix(ship({
      'Zone A': { countries: ['US'], rates: {
        'FedEx IP (1–2 kg)': { type: 'flat', price: 80, currency: 'USD' },
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 54.5, currency: 'USD' },
        'FedEx IP (0.5–1 kg)': { type: 'flat', price: 64, currency: 'USD' },
      } },
    }));
    expect(z).toHaveLength(1);
    expect(z[0].zoneName).toBe('Zone A');
    expect(z[0].countries).toEqual(['US']);
    expect(z[0].rates.map((r) => r.price)).toEqual([54.5, 64, 80]);
  });
  it('label không khớp regex đẩy cuối', () => {
    const z = flattenShippingMatrix(ship({
      'Z': { countries: [], rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 10, currency: 'USD' },
        'Đồng giá': { type: 'flat', price: 99, currency: 'USD' },
      } },
    }));
    expect(z[0].rates.map((r) => r.label)).toEqual(['FedEx IP (0–0.5 kg)', 'Đồng giá']);
  });
  it('giữ thứ tự zone', () => {
    const z = flattenShippingMatrix(ship({
      'B': { countries: [], rates: {} }, 'A': { countries: [], rates: {} },
    }));
    expect(z.map((x) => x.zoneName)).toEqual(['B', 'A']);
  });
  it('mang label ra ZoneView', () => {
    const z = flattenShippingMatrix(ship({
      'ME1': { countries: ['AE'], rates: {}, label: 'Middle East — DHL 9 / FedEx H' },
      'ME2': { countries: ['IL'], rates: {} },
    }));
    expect(z[0].label).toBe('Middle East — DHL 9 / FedEx H');
    expect(z[1].label).toBeUndefined();
  });
});

describe('carriersInZones', () => {
  it('carrier distinct theo thứ tự xuất hiện đầu, gộp nhiều zone', () => {
    const zones = flattenShippingMatrix({ zones: {
      'Z1': { countries: ['SA'], rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 51, currency: 'USD' },
        'DHL Express (0–0.5 kg)': { type: 'flat', price: 46, currency: 'USD' },
      } },
      'Z2': { countries: ['AE'], rates: {
        'DHL Express (0–0.5 kg)': { type: 'flat', price: 47, currency: 'USD' },
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 52, currency: 'USD' },
      } },
    } });
    expect(carriersInZones(zones)).toEqual(['FedEx IP', 'DHL Express']);
  });
  it('[] → []', () => {
    expect(carriersInZones([])).toEqual([]);
  });
});

describe('buildZoneWeightMatrix', () => {
  const zones = flattenShippingMatrix({ zones: {
    'Z1': { countries: ['SA'], rates: {
      'FedEx IP (0.5–1 kg)': { type: 'flat', price: 60, currency: 'USD' },
      'FedEx IP (0–0.5 kg)': { type: 'flat', price: 51, currency: 'USD' },
      'DHL Express (0–0.5 kg)': { type: 'flat', price: 46, currency: 'USD' },
    } },
    'Z2': { countries: ['AE'], rates: {
      'FedEx IP (0–0.5 kg)': { type: 'flat', price: 52, currency: 'USD' },
      'FedEx IP (1–1.5 kg)': { type: 'flat', price: 70, currency: 'USD' },
    } },
  } });

  it('cột = zone, dòng = bậc cân sắp theo cận trên kg, lọc đúng carrier', () => {
    const m = buildZoneWeightMatrix(zones, 'FedEx IP');
    expect(m.zoneNames).toEqual(['Z1', 'Z2']);
    expect(m.rows.map((r) => r.bracket)).toEqual(['0–0.5 kg', '0.5–1 kg', '1–1.5 kg']);
    // bậc 0–0.5: Z1 51, Z2 52
    expect(m.rows[0].cells).toEqual([{ price: 51, currency: 'USD' }, { price: 52, currency: 'USD' }]);
    // bậc 0.5–1: chỉ Z1 có
    expect(m.rows[1].cells).toEqual([{ price: 60, currency: 'USD' }, null]);
    // bậc 1–1.5: chỉ Z2 có
    expect(m.rows[2].cells).toEqual([null, { price: 70, currency: 'USD' }]);
  });

  it('chỉ gồm bậc của carrier được chọn', () => {
    const m = buildZoneWeightMatrix(zones, 'DHL Express');
    expect(m.zoneNames).toEqual(['Z1', 'Z2']);
    expect(m.rows.map((r) => r.bracket)).toEqual(['0–0.5 kg']);
    expect(m.rows[0].cells).toEqual([{ price: 46, currency: 'USD' }, null]);
  });

  it('carrier không tồn tại → rows rỗng, vẫn giữ cột zone', () => {
    const m = buildZoneWeightMatrix(zones, 'UPS');
    expect(m.zoneNames).toEqual(['Z1', 'Z2']);
    expect(m.rows).toEqual([]);
  });
});

describe('parseRateSearch', () => {
  it('token cân nặng → weight, needle rỗng', () => {
    expect(parseRateSearch('2kg')).toEqual({ needle: '', weight: 2 });
    expect(parseRateSearch('2 kg')).toEqual({ needle: '', weight: 2 });
    expect(parseRateSearch('0.5')).toEqual({ needle: '', weight: 0.5 });
    expect(parseRateSearch('  3KG ')).toEqual({ needle: '', weight: 3 });
  });
  it('chữ → needle (lowercase), weight null', () => {
    expect(parseRateSearch('SA')).toEqual({ needle: 'sa', weight: null });
    expect(parseRateSearch('FedEx H')).toEqual({ needle: 'fedex h', weight: null });
    expect(parseRateSearch('')).toEqual({ needle: '', weight: null });
  });
});

describe('bracketMatchesWeight', () => {
  it('cân rơi vào (lo, hi]', () => {
    expect(bracketMatchesWeight('0–0.5 kg', 0.5)).toBe(true);
    expect(bracketMatchesWeight('0–0.5 kg', 0.3)).toBe(true);
    expect(bracketMatchesWeight('0.5–1 kg', 0.5)).toBe(false);
    expect(bracketMatchesWeight('1–2 kg', 2)).toBe(true);
    expect(bracketMatchesWeight('1–2 kg', 2.1)).toBe(false);
  });
  it('bậc không phải dải → so khớp chuỗi', () => {
    expect(bracketMatchesWeight('—', 2)).toBe(false);
  });
});

describe('buildMarketCodes', () => {
  it('luôn 2 chữ: nhiều từ → 2 chữ đầu mỗi từ đầu; một từ → 2 chữ đầu', () => {
    expect(buildMarketCodes(['middle-east', 'united-states', 'south-east-asia', 'japan', 'korea', 'europe'])).toEqual({
      'middle-east': 'ME',
      'united-states': 'US',
      'south-east-asia': 'SE',
      'japan': 'JA',
      'korea': 'KO',
      'europe': 'EU',
    });
  });
  it('trùng mã → thêm số để duy nhất, ổn định theo thứ tự', () => {
    expect(buildMarketCodes(['middle-east', 'middle-earth'])).toEqual({
      'middle-east': 'ME',
      'middle-earth': 'ME2',
    });
  });
});

describe('applyZoneCodes', () => {
  it('đổi key zone → mã+số (không gạch), nhét tên cũ vào label, giữ countries/rates', () => {
    const out = applyZoneCodes({ zones: {
      'Middle East — DHL 9 / FedEx H': { countries: ['AE', 'SA'], rates: { 'FedEx IP (0–0.5 kg)': { type: 'flat', price: 51, currency: 'USD' } } },
      'Middle East — DHL 10 / FedEx F': { countries: ['IL'], rates: {} },
    } }, 'ME');
    expect(Object.keys(out.zones)).toEqual(['ME1', 'ME2']);
    expect(out.zones['ME1'].label).toBe('Middle East — DHL 9 / FedEx H');
    expect(out.zones['ME1'].countries).toEqual(['AE', 'SA']);
    expect(out.zones['ME1'].rates['FedEx IP (0–0.5 kg)'].price).toBe(51);
    expect(out.zones['ME2'].label).toBe('Middle East — DHL 10 / FedEx F');
  });
  it('idempotent: zone đã có label thì giữ label gốc khi chạy lại', () => {
    const out = applyZoneCodes({ zones: {
      'ME1': { countries: ['AE'], rates: {}, label: 'Middle East — DHL 9 / FedEx H' },
    } }, 'ME');
    expect(Object.keys(out.zones)).toEqual(['ME1']);
    expect(out.zones['ME1'].label).toBe('Middle East — DHL 9 / FedEx H');
  });
});

describe('zoneCarrierLabel', () => {
  it('lấy phần sau dấu gạch (carrier-zone)', () => {
    expect(zoneCarrierLabel('Middle East — DHL 9 / FedEx H')).toBe('DHL 9 / FedEx H');
    expect(zoneCarrierLabel('United States — DHL 7 / FedEx D')).toBe('DHL 7 / FedEx D');
  });
  it('không có dấu gạch → trả nguyên tên', () => {
    expect(zoneCarrierLabel('Zone A')).toBe('Zone A');
  });
});

describe('summarizeZoneCountries', () => {
  it('≤ max → hiện hết, extra 0', () => {
    expect(summarizeZoneCountries(['AE', 'SA', 'QA'], 6)).toEqual({ shown: ['AE', 'SA', 'QA'], extra: 0 });
  });

  it('> max → ưu tiên nước lớn lên đầu, cắt còn max, extra = phần dư', () => {
    // AF,AO,BF… (không lớn) + ZA,NG,EG (lớn) → 3 lớn lên trước
    const codes = ['AF', 'AO', 'BF', 'ZA', 'BI', 'NG', 'BJ', 'EG', 'BW'];
    const r = summarizeZoneCountries(codes, 4);
    expect(r.shown.slice(0, 3)).toEqual(['ZA', 'NG', 'EG']); // nước lớn trước (giữ thứ tự gốc giữa chúng)
    expect(r.shown).toHaveLength(4);
    expect(r.extra).toBe(5);
  });
});
