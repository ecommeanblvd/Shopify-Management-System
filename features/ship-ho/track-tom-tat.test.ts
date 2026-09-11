import { describe, it, expect } from 'vitest';
import { chuanHoaLoi, gomLoi, coiLaHong, SO_LOI_GIU } from './track-tom-tat';

describe('chuanHoaLoi', () => {
  it('lấy dòng đầu, bỏ khoảng trắng thừa', () => {
    expect(chuanHoaLoi('  Thiếu FEDEX_CLIENT_ID\n    at foo (bar.ts:1)  ')).toBe('Thiếu FEDEX_CLIENT_ID');
  });
  it('gộp các lỗi chỉ khác mã vận đơn thành một dòng', () => {
    expect(chuanHoaLoi('FedEx 404 cho 876411523948')).toBe(chuanHoaLoi('FedEx 404 cho 876456183856'));
  });
  it('cắt lỗi quá dài', () => {
    expect(chuanHoaLoi('x'.repeat(400)).endsWith('…')).toBe(true);
  });
});

describe('gomLoi', () => {
  it('đếm theo lý do, nhiều nhất trước', () => {
    expect(gomLoi(['a', 'b', 'a', 'a', 'b'])).toEqual({ a: 3, b: 2 });
  });
  it('không có lỗi nào → undefined, để summary sạch', () => {
    expect(gomLoi([])).toBeUndefined();
  });
  it(`giữ tối đa ${SO_LOI_GIU} lý do, phần còn lại gom vào một dòng`, () => {
    const msgs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const r = gomLoi(msgs)!;
    expect(Object.keys(r)).toHaveLength(SO_LOI_GIU + 1);
    expect(r['(lý do khác)']).toBe(2);
  });
});

describe('coiLaHong', () => {
  it('có lỗi mà không tra được kiện nào → hỏng', () => {
    expect(coiLaHong({ tracked: 0, failed: 46 })).toBe(true);
  });
  it('tra được một phần → chưa coi là hỏng cả lượt', () => {
    expect(coiLaHong({ tracked: 10, failed: 3 })).toBe(false);
  });
  it('không có việc để làm → bình thường, không báo động', () => {
    expect(coiLaHong({ tracked: 0, failed: 0 })).toBe(false);
  });
});
