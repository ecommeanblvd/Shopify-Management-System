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
});
