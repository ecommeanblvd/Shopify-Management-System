import { describe, it, expect } from 'vitest';
import { matchRemoteCity } from './remote-city-match';

const P = (entries: Array<[string, string | null]>) => new Map<string, string | null>(entries);

describe('matchRemoteCity', () => {
  const sa = P([['BURAYDAH', 'Tier B'], ['BURAIDAH', 'Tier B'], ['DUWADIMI', 'Tier B'], ['AFIF', 'Tier B'], ['ULA', null]]);

  it('exact match', () => {
    expect(matchRemoteCity(['BURAYDAH'], sa)).toEqual({ tier: 'Tier B' });
  });

  it('alias: Burydah (thiếu A) → Buraydah', () => {
    expect(matchRemoteCity(['BURYDAH'], sa)).toEqual({ tier: 'Tier B' });
  });

  it('bỏ tiền tố AL: ALDUWADIMI → DUWADIMI', () => {
    expect(matchRemoteCity(['ALDUWADIMI'], sa)).toEqual({ tier: 'Tier B' });
  });

  it('prefix: city dính tên vùng "BURAIDAHALQASSIM" → BURAIDAH', () => {
    expect(matchRemoteCity(['BURAIDAHALQASSIM'], sa)).toEqual({ tier: 'Tier B' });
  });

  it('tier null vẫn coi là khớp (có trong list, không phân bậc)', () => {
    expect(matchRemoteCity(['ULA'], sa)).toEqual({ tier: null });
  });

  it('không khớp → null', () => {
    expect(matchRemoteCity(['RIYADH'], sa)).toBeNull();
  });

  it('không prefix-match pattern ngắn (<5): "AFIFABAD" không khớp AFIF', () => {
    // AFIF dài 4 < MIN_PREFIX_LEN nên prefix không kích hoạt → tránh nhiễu.
    expect(matchRemoteCity(['AFIFABAD'], sa)).toBeNull();
  });

  it('prefix lấy pattern DÀI nhất khi nhiều pattern khớp đầu', () => {
    const p = P([['BURA', 'Tier A'], ['BURAIDAH', 'Tier B']]);
    // 'BURA' < 5 nên bị loại; chỉ BURAIDAH (≥5) khớp prefix.
    expect(matchRemoteCity(['BURAIDAHX'], p)).toEqual({ tier: 'Tier B' });
  });
});
