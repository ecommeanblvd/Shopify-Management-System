import { describe, it, expect } from 'vitest';
import { neutralNotes } from './brand-estimate';

describe('neutralNotes — không lộ tên hãng', () => {
  it('không chứa "FedEx"/"DHL"', () => {
    const joined = neutralNotes().join(' ');
    expect(joined).not.toMatch(/fedex|dhl/i);
  });
  it('nêu phụ phí xăng dầu theo tuần + giá dự kiến theo cân/kích thước', () => {
    const joined = neutralNotes().join(' ');
    expect(joined).toMatch(/xăng dầu/i);
    expect(joined).toMatch(/dự kiến|cân|kích thước/i);
  });
});
