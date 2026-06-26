import { describe, it, expect } from 'vitest';
import { pickLatestRecord, sortRecordsLatestFirst, larkCreatedTime } from './record-select';
import type { LarkRecord } from './client';

const rec = (id: string, t?: number): LarkRecord => ({ record_id: id, fields: {}, created_time: t });

describe('record-select', () => {
  it('larkCreatedTime: thiếu → 0', () => {
    expect(larkCreatedTime(rec('a'))).toBe(0);
    expect(larkCreatedTime(rec('a', 123))).toBe(123);
  });
  it('pickLatestRecord: chọn created_time lớn nhất', () => {
    expect(pickLatestRecord([rec('a', 100), rec('b', 300), rec('c', 200)])?.record_id).toBe('b');
  });
  it('pickLatestRecord: thiếu created_time hết → record CUỐI mảng', () => {
    expect(pickLatestRecord([rec('a'), rec('b'), rec('c')])?.record_id).toBe('c');
  });
  it('pickLatestRecord: rỗng → null', () => {
    expect(pickLatestRecord([])).toBeNull();
  });
  it('sortRecordsLatestFirst: desc theo created_time, ổn định', () => {
    const out = sortRecordsLatestFirst([rec('a', 100), rec('b', 300), rec('c', 200)]);
    expect(out.map((r) => r.record_id)).toEqual(['b', 'c', 'a']);
  });
});
