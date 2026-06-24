import { describe, expect, it } from 'vitest';
import { flattenLarkRecord } from './detail';

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
