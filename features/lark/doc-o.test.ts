import { describe, it, expect } from 'vitest';
import { docChuO, docDanhSachO, docSoO } from './doc-o';

describe('docChuO', () => {
  it('cột chọn trả chuỗi thường', () => {
    expect(docChuO('QC Pass')).toBe('QC Pass');
  });

  it('cột text nhiều đoạn → nối lại', () => {
    expect(docChuO([{ text: '#MBLVD', type: 'text' }, { text: '29466', type: 'text' }]))
      .toBe('#MBLVD29466');
  });

  /* Hình dạng mà cả ba bản đọc cũ trong repo đều trả về rỗng — và là hình dạng của ba cột em
     cần trên bảng `LOG - Import`. */
  it('cột LOOKUP bọc {type, value} → đọc được lớp trong', () => {
    expect(docChuO({ type: 1, value: [{ text: '#MBLVD29466', type: 'text' }] }))
      .toBe('#MBLVD29466');
    expect(docChuO({ type: 3, value: ['QC Pass'] })).toBe('QC Pass');
  });

  it('ô trống dưới mọi dạng → null, KHÔNG phải chuỗi rỗng', () => {
    expect(docChuO(null)).toBeNull();
    expect(docChuO(undefined)).toBeNull();
    expect(docChuO('')).toBeNull();
    expect(docChuO('   ')).toBeNull();
    expect(docChuO([])).toBeNull();
    expect(docChuO({ type: 3, value: [] })).toBeNull();
  });

  it('cột người / cột có `name` cũng đọc ra chữ', () => {
    expect(docChuO([{ name: 'Tuyết Nguyễn', id: 'ou_x' }])).toBe('Tuyết Nguyễn');
  });

  it('số và bool vẫn ra chữ, không mất giá trị', () => {
    expect(docChuO(1)).toBe('1');
    expect(docChuO(0)).toBe('0');
    expect(docChuO(true)).toBe('true');
  });
});

describe('docDanhSachO', () => {
  it('lookup trả nhiều dòng → nhiều giá trị, không nối thành một chuỗi', () => {
    expect(docDanhSachO({ type: 3, value: ['QC Pass', 'QC Failed'] }))
      .toEqual(['QC Pass', 'QC Failed']);
  });
  it('bỏ phần tử rỗng', () => {
    expect(docDanhSachO([{ text: 'a' }, { text: '  ' }, { text: 'b' }])).toEqual(['a', 'b']);
  });
});

describe('docSoO', () => {
  it('số thường và số bọc trong lookup', () => {
    expect(docSoO(1)).toBe(1);
    expect(docSoO({ type: 2, value: [53000] })).toBe(53000);
  });

  /* Trống KHÔNG được thành 0: "chưa có số lượng" khác hẳn "số lượng bằng 0", và 0 thì làm dòng
     trông như đã nhập đủ. */
  it('trống → null, không phải 0', () => {
    expect(docSoO(null)).toBeNull();
    expect(docSoO('')).toBeNull();
    expect(docSoO({ type: 2, value: [] })).toBeNull();
  });

  it('chuỗi không phải số → null, không bịa', () => {
    expect(docSoO('chưa rõ')).toBeNull();
  });
});
