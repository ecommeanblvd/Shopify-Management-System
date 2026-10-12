import { describe, it, expect } from 'vitest';
import { nguonGiaCho } from './lay-gia-uoc-tinh';

describe('nguonGiaCho', () => {
  it('fedex → API FedEx', () => { expect(nguonGiaCho('fedex')).toBe('fedex-api'); });
  it('ups → API UPS', () => { expect(nguonGiaCho('ups')).toBe('ups-api'); });
  /* Review Focus #5: Aramex/DHL đi bảng giá, KHÔNG phải lỗi. Engine có 1.800 ô giá
   * cho Aramex và 1.520 ô cho DHL; CEO xác nhận cách tính đã khớp bill Aramex. */
  it('aramex → bảng giá', () => { expect(nguonGiaCho('aramex')).toBe('bang-gia'); });
  it('dhl → bảng giá', () => { expect(nguonGiaCho('dhl')).toBe('bang-gia'); });
  it('hãng chưa biết / null → bảng giá, không ném lỗi', () => {
    expect(nguonGiaCho(null)).toBe('bang-gia');
    expect(nguonGiaCho('hang-moi')).toBe('bang-gia');
  });
});
