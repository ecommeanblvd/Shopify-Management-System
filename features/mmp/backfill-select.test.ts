import { describe, it, expect } from 'vitest';
import { pickBackfillOrderIds } from './backfill-select';

describe('pickBackfillOrderIds', () => {
  it('dedupe orderId (nhiều dòng brand cùng đơn)', () => {
    expect(pickBackfillOrderIds(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });
  it('limit N → chỉ N đơn đầu (sau dedupe)', () => {
    expect(pickBackfillOrderIds(['a', 'b', 'a', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });
  it('limit để trống / 0 / âm → tất cả', () => {
    expect(pickBackfillOrderIds(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(pickBackfillOrderIds(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    expect(pickBackfillOrderIds(['a', 'b', 'c'], -1)).toEqual(['a', 'b', 'c']);
  });
  it('limit > số đơn → tất cả', () => {
    expect(pickBackfillOrderIds(['a', 'b'], 99)).toEqual(['a', 'b']);
  });
});
