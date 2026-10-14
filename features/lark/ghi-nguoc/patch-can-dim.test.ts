import { describe, expect, test } from 'vitest';
import { xemTruocGhiCanDim } from './patch-can-dim';

describe('xemTruocGhiCanDim', () => {
  test('ô Lark trống → điền cả hai', () => {
    const { patch, canhBao } = xemTruocGhiCanDim({ canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 }, {}, {});
    expect(patch).toEqual({ 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' });
    expect(canhBao).toEqual([]);
  });

  test('ô NGƯỜI KHÁC đã gõ, không có biên nhận → không đè, có cảnh báo', () => {
    const { patch, canhBao } = xemTruocGhiCanDim(
      { canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 },
      { 'Weights': 2.0, 'Dimension ( điền tay)': '39x29x9' }, {});
    expect(patch).toEqual({});
    expect(canhBao).toHaveLength(2);
  });

  test('Lark vẫn giữ đúng biên nhận hệ thống đã ghi → ĐƯỢC đè lại, không cảnh báo', () => {
    const { patch, canhBao } = xemTruocGhiCanDim(
      { canKg: 2.1, daiCm: 40, rongCm: 30, caoCm: 12 },
      { 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' },
      { 'Weights': 2.4, 'Dimension ( điền tay)': '40x30x12' });
    expect(patch['Weights']).toBe(2.1);
    expect(patch['Dimension ( điền tay)']).toBe('40x30x12');
    expect(canhBao).toEqual([]);
  });

  test('người đã SỬA LẠI ô sau lượt ghi trước (Lark khác biên nhận) → không đè, cảnh báo nêu tên cột', () => {
    const { patch, canhBao } = xemTruocGhiCanDim(
      { canKg: 2.1, daiCm: null, rongCm: null, caoCm: null },
      { 'Weights': 3.0 }, // người sửa tay từ 2.4 (biên nhận) thành 3.0
      { 'Weights': 2.4 });
    expect(patch).toEqual({});
    expect(canhBao).toHaveLength(1);
    expect(canhBao[0]).toContain('Weights');
  });

  test('biên nhận là SỐ nhưng Lark trả về CHUỖI số (endpoint GET records/:id) → vẫn khớp, được đè', () => {
    const { patch, canhBao } = xemTruocGhiCanDim(
      { canKg: 2.1, daiCm: null, rongCm: null, caoCm: null },
      { 'Weights': '2.4' }, // GET records/:id trả chuỗi cho ô số, xem dung-patch.ts
      { 'Weights': 2.4 });
    expect(patch).toEqual({ 'Weights': 2.1 });
    expect(canhBao).toEqual([]);
  });

  test('thiếu chiều cao → chuỗi hai số, không chèn 0', () => {
    const { patch } = xemTruocGhiCanDim({ canKg: 1, daiCm: 28, rongCm: 42, caoCm: null }, {}, {});
    expect(patch['Dimension ( điền tay)']).toBe('28x42');
  });

  test('không có gì để ghi → patch rỗng', () => {
    const { patch, canhBao } = xemTruocGhiCanDim({ canKg: null, daiCm: null, rongCm: null, caoCm: null }, {}, {});
    expect(patch).toEqual({});
    expect(canhBao).toEqual([]);
  });

  test('chỉ MỘT trong hai ô người khác gõ → chỉ ô đó bị bỏ qua, ô còn lại vẫn ghi', () => {
    const { patch, canhBao } = xemTruocGhiCanDim(
      { canKg: 2.4, daiCm: 40, rongCm: 30, caoCm: 12 },
      { 'Weights': 2.0 }, {});
    expect(patch).toEqual({ 'Dimension ( điền tay)': '40x30x12' });
    expect(canhBao).toHaveLength(1);
    expect(canhBao[0]).toContain('Weights');
  });

  test('thiếu dài hoặc rộng → không ghi ô kích thước, không cảnh báo (không có gì để ghi)', () => {
    const { patch, canhBao } = xemTruocGhiCanDim({ canKg: null, daiCm: 40, rongCm: null, caoCm: null }, {}, {});
    expect(patch).toEqual({});
    expect(canhBao).toEqual([]);
  });
});
