import { describe, it, expect } from 'vitest';
import { locDongTheoMon } from './wh-inventory';

const rec = (id: string, monIds: string[]) => ({
  record_id: id,
  fields: { 'Import (select order)': { link_record_ids: monIds } },
});

describe('locDongTheoMon', () => {
  it('chọn ĐÚNG dòng nối tới món này, không lấy nhầm dòng khác của cùng đơn', () => {
    const recs = [rec('recA', ['recMON1']), rec('recB', ['recMON2'])];
    expect(locDongTheoMon(recs, 'recMON2')).toBe('recB');
  });
  it('chưa có dòng nào của món → null (sẽ tạo mới)', () => {
    expect(locDongTheoMon([rec('recA', ['recMON1'])], 'recMONX')).toBeNull();
  });
  it('dòng không có link thì bỏ qua, không nổ', () => {
    expect(locDongTheoMon([{ record_id: 'recC', fields: {} }], 'recMON1')).toBeNull();
  });
  it('nhiều dòng cùng món → lấy dòng ĐẦU, để không tạo thêm bản sao', () => {
    const recs = [rec('recA', ['recMON1']), rec('recB', ['recMON1'])];
    expect(locDongTheoMon(recs, 'recMON1')).toBe('recA');
  });
});
