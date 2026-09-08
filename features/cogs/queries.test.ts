import { describe, it, expect } from 'vitest';
import { ranhThang } from './queries';

describe('ranhThang', () => {
  it('biên tháng 2026-08 theo giờ Bangkok (UTC+7)', () => {
    const { from, to } = ranhThang('2026-08');
    expect(from).toEqual(new Date('2026-08-01T00:00:00+07:00'));
    expect(to).toEqual(new Date(new Date('2026-09-01T00:00:00+07:00').getTime() - 1));
  });

  it('tháng 12 lăn sang tháng 1 năm sau', () => {
    const { from, to } = ranhThang('2026-12');
    expect(from).toEqual(new Date('2026-12-01T00:00:00+07:00'));
    expect(to).toEqual(new Date(new Date('2027-01-01T00:00:00+07:00').getTime() - 1));
  });
});
