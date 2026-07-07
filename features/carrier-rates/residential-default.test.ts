import { describe, it, expect } from 'vitest';
import { isDefaultResidential } from './residential-default';

describe('isDefaultResidential', () => {
  it('true cho US và CA (nơi FedEx có phí residential)', () => {
    expect(isDefaultResidential('US')).toBe(true);
    expect(isDefaultResidential('CA')).toBe(true);
    expect(isDefaultResidential('us')).toBe(true); // case-insensitive
  });
  it('false cho nước khác', () => {
    expect(isDefaultResidential('GB')).toBe(false);
    expect(isDefaultResidential('VN')).toBe(false);
    expect(isDefaultResidential('')).toBe(false);
  });
});
