import { describe, it, expect } from 'vitest';
import { cheDoGhiNguoc, khopRecordTheoCode } from './ghi-nguoc';

describe('cheDoGhiNguoc', () => {
  it('"1" → ghi; "dry" → dry; trống/khác → tắt', () => {
    expect(cheDoGhiNguoc('1')).toBe('ghi');
    expect(cheDoGhiNguoc('dry')).toBe('dry');
    expect(cheDoGhiNguoc('')).toBe('tat');
    expect(cheDoGhiNguoc(undefined)).toBe('tat');
    expect(cheDoGhiNguoc('yes')).toBe('tat');
  });
});

describe('khopRecordTheoCode', () => {
  it('khoá là Log Unique code; dạng chuỗi lẫn rich text; dòng không có code bị bỏ', () => {
    const m = khopRecordTheoCode([
      { record_id: 'a', fields: { 'Log Unique code': 'PK-1' } },
      { record_id: 'b', fields: { 'Log Unique code': [{ text: 'PK-2', type: 'text' }] } },
      { record_id: 'c', fields: {} },
    ]);
    expect(m.get('PK-1')?.record_id).toBe('a');
    expect(m.get('PK-2')?.record_id).toBe('b');
    expect(m.size).toBe(2);
  });
});
