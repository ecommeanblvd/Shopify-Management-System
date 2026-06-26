import { describe, expect, it } from 'vitest';
import { flattenLarkRecord, pickLarkFields, LARK_DETAIL_FIELDS } from './detail';

describe('flattenLarkRecord', () => {
  it('làm phẳng field text/lookup, bỏ field rỗng', () => {
    const out = flattenLarkRecord({
      'Order Number': '#MBLVD1',
      'CX-FF Status (look up)': [{ text: 'OK' }],
      'Empty': '',
      'Null': null,
    });
    expect(out).toContainEqual({ label: 'Order Number', value: '#MBLVD1' });
    expect(out).toContainEqual({ label: 'CX-FF Status (look up)', value: 'OK' });
    expect(out.find((f) => f.label === 'Empty')).toBeUndefined();
    expect(out.find((f) => f.label === 'Null')).toBeUndefined();
  });

  it('số → chuỗi', () => {
    const out = flattenLarkRecord({ 'Weights': 1.5 });
    expect(out).toContainEqual({ label: 'Weights', value: '1.5' });
  });

  it('field ngày (epoch ms) → dd/MM/yyyy, KHÔNG hiện số raw', () => {
    const ms = Date.UTC(2026, 5, 7, 17, 0, 0); // → nửa đêm VN 2026-06-08
    const out = flattenLarkRecord({
      'Label Created Date': ms,
      'Ngày giao dự kiến': ms,
      'Ngày giao thực tế': ms,
    });
    expect(out).toContainEqual({ label: 'Label Created Date', value: '08/06/2026' });
    expect(out).toContainEqual({ label: 'Ngày giao dự kiến', value: '08/06/2026' });
    expect(out).toContainEqual({ label: 'Ngày giao thực tế', value: '08/06/2026' });
  });

  it('field số TIỀN (không phải ngày) giữ nguyên số raw', () => {
    const out = flattenLarkRecord({ 'Mức giá cơ sở': 3442200, 'INS | Chi phí Tổng (đ)': 1801956 });
    expect(out).toContainEqual({ label: 'Mức giá cơ sở', value: '3442200' });
    expect(out).toContainEqual({ label: 'INS | Chi phí Tổng (đ)', value: '1801956' });
  });
});

describe('pickLarkFields', () => {
  it('lấy đúng field theo thứ tự danh sách, bỏ rỗng/thiếu', () => {
    const out = pickLarkFields(
      { 'Tracking Number': '123', 'Weights': 1.5, 'Couriers': '', 'Khác': 'x' },
      ['Couriers', 'Tracking Number', 'Weights'],
    );
    expect(out).toEqual([
      { label: 'Tracking Number', value: '123' },
      { label: 'Weights', value: '1.5' },
    ]);
  });
  it('field lookup-array → text', () => {
    expect(pickLarkFields({ 'CX-FF Status (look up)': [{ text: 'OK' }] }, ['CX-FF Status (look up)']))
      .toEqual([{ label: 'CX-FF Status (look up)', value: 'OK' }]);
  });
  it('danh sách curated có 12 field', () => {
    expect(LARK_DETAIL_FIELDS.length).toBe(12);
    expect(LARK_DETAIL_FIELDS).toContain('Final | Delivery Status');
  });
  it('field ngày trong danh sách curated → dd/MM/yyyy', () => {
    const ms = Date.UTC(2026, 5, 7, 17, 0, 0);
    expect(pickLarkFields({ 'Ngày giao dự kiến': ms }, ['Ngày giao dự kiến']))
      .toEqual([{ label: 'Ngày giao dự kiến', value: '08/06/2026' }]);
  });
});
