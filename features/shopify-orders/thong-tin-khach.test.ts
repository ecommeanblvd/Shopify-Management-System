import { describe, it, expect } from 'vitest';
import { tachEdd, locSoDo, tenKhach } from './thong-tin-khach';

describe('tachEdd', () => {
  it('tách được dạng không kèm thứ', () => {
    expect(tachEdd('6 October - 20 October')).toEqual({ min: '6 October', max: '20 October' });
  });

  /* Dạng kèm thứ có dấu phẩy nhưng KHÔNG có " - " bên trong, nên vẫn tách gọn.
   * Đo 6.161/6.161 dòng đều có đúng MỘT lần " - ". */
  it('tách được dạng kèm thứ trong tuần', () => {
    expect(tachEdd('Friday, 06 March - Tuesday, 17 March'))
      .toEqual({ min: 'Friday, 06 March', max: 'Tuesday, 17 March' });
  });

  it('không có dấu tách thì coi cả chuỗi là đầu MIN', () => {
    expect(tachEdd('20 October')).toEqual({ min: '20 October', max: null });
  });

  it('rỗng hoặc null → hai đầu đều null', () => {
    expect(tachEdd(null)).toEqual({ min: null, max: null });
    expect(tachEdd('   ')).toEqual({ min: null, max: null });
  });
});

describe('locSoDo', () => {
  const a = [
    { key: '2--3.Hip*', value: '107 cm' },
    { key: '1--1.Bust*', value: '91 cm' },
    { key: 'Estimated Delivery', value: '6 October - 20 October' },
    { key: '1--2.Waist*', value: '71 cm' },
    { key: '_Customize Type', value: 'Collar Dresses' },
  ];

  /* Sắp theo tiền tố thứ tự, KHÔNG theo bảng chữ cái — đó là trình tự người
   * thợ đọc khi may. `_Customize Type` không có tiền tố nên đứng đầu. */
  it('sắp theo thứ tự khách nhập, không theo chữ cái', () => {
    expect(locSoDo(a).map((x) => x.nhan)).toEqual(['Customize Type', 'Bust', 'Waist', 'Hip']);
  });

  it('bỏ tiền tố thứ tự và dấu sao trong nhãn', () => {
    expect(locSoDo([{ key: '3--5.Biceps/Upper Arms*', value: '30 cm' }])[0])
      .toEqual({ nhan: 'Biceps/Upper Arms', giaTri: '30 cm' });
  });

  /* Estimated Delivery đã có cột riêng — để lại là một con số ngày nằm giữa
   * bảng số đo cơ thể. */
  it('loại Estimated Delivery ra khỏi bảng số đo', () => {
    expect(locSoDo(a).some((x) => /Estimated/i.test(x.nhan))).toBe(false);
  });

  it('bỏ thuộc tính không có giá trị', () => {
    expect(locSoDo([{ key: '1--1.Bust*', value: '  ' }, { key: '1--2.Waist*', value: null }])).toEqual([]);
  });

  it('rỗng hoặc null → mảng rỗng, không ném', () => {
    expect(locSoDo(null)).toEqual([]);
    expect(locSoDo([])).toEqual([]);
  });
});

describe('tenKhach', () => {
  it('ghép họ và tên', () => expect(tenKhach('Alexandra', 'Sanders')).toBe('Alexandra Sanders'));
  it('thiếu một nửa vẫn ra tên', () => expect(tenKhach(null, 'Wu')).toBe('Wu'));
  it('rỗng cả hai → null, không trả chuỗi trắng', () => {
    expect(tenKhach(null, null)).toBeNull();
    expect(tenKhach('  ', ' ')).toBeNull();
  });
});
