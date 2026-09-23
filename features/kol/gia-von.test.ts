import { describe, it, expect } from 'vitest';
import { chonGiaVon } from './gia-von';

const g = (costPerUnit: string, effectiveFrom: string, currency = 'VND') => ({ costPerUnit, currency, effectiveFrom });

describe('chonGiaVon', () => {
  it('lấy dòng có hiệu lực mới nhất mà KHÔNG vượt quá ngày gửi', () => {
    expect(chonGiaVon([g('100', '2026-01-01'), g('120', '2026-06-01'), g('150', '2026-12-01')], '2026-09-23'))
      .toEqual(g('120', '2026-06-01'));
  });
  it('mọi dòng đều sau ngày gửi thì trả null, KHÔNG lấy bừa dòng gần nhất', () => {
    expect(chonGiaVon([g('150', '2026-12-01')], '2026-09-23')).toBeNull();
  });
  it('đúng ngày hiệu lực thì tính là có hiệu lực', () => {
    expect(chonGiaVon([g('120', '2026-09-23')], '2026-09-23')).toEqual(g('120', '2026-09-23'));
  });
  it('danh sách rỗng trả null', () => {
    expect(chonGiaVon([], '2026-09-23')).toBeNull();
  });
});
