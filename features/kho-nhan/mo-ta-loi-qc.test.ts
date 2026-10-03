import { describe, it, expect } from 'vitest';
import { moTaLoiQc } from './mo-ta-loi-qc';

describe('moTaLoiQc', () => {
  it('một lỗi không ghi chú → đúng nhãn tiếng Việt', () => {
    expect(moTaLoiQc([{ lyDo: 'ban', ghiChu: null }])).toBe('Bẩn');
  });

  it('nhiều lỗi khác nhau nối bằng dấu chấm giữa', () => {
    expect(moTaLoiQc([{ lyDo: 'ban', ghiChu: null }, { lyDo: 'xuoc_vai', ghiChu: null }]))
      .toBe('Bẩn · Xước vải');
  });

  /* Kho hay ghi hai dòng CÙNG lý do với hai tấm ảnh khác nhau — in "Bẩn · Bẩn" thì đọc như
     lỗi đánh máy. Dữ liệu thật 02/10: 7 dòng lỗi trên 6 chiếc. */
  it('trùng lý do thì gộp, không in hai lần', () => {
    expect(moTaLoiQc([{ lyDo: 'ban', ghiChu: null }, { lyDo: 'ban', ghiChu: null }])).toBe('Bẩn');
  });

  it('giữ ghi chú trong ngoặc, nhiều ghi chú cùng lý do thì nối bằng dấu chấm phẩy', () => {
    expect(moTaLoiQc([
      { lyDo: 'ban', ghiChu: 'vết ố cổ áo' },
      { lyDo: 'ban', ghiChu: 'gấu quần' },
    ])).toBe('Bẩn (vết ố cổ áo; gấu quần)');
  });

  /* Lý do "khac" bắt buộc có ghi chú (xem `kiemDongLoi`), nên nhãn trần "Khác" là vô nghĩa —
     ghi chú chính là nội dung. */
  it('lý do Khác luôn kèm ghi chú', () => {
    expect(moTaLoiQc([{ lyDo: 'khac', ghiChu: 'chỉ thừa khắp thân' }]))
      .toBe('Khác (chỉ thừa khắp thân)');
  });

  it('ghi chú trùng nhau thì chỉ in một lần', () => {
    expect(moTaLoiQc([
      { lyDo: 'ban', ghiChu: 'vết ố' }, { lyDo: 'ban', ghiChu: 'vết ố' },
    ])).toBe('Bẩn (vết ố)');
  });

  /* Rỗng = XOÁ lý do cũ trên Lark — đúng thứ cần khi chiếc được kiểm lại thành đạt. */
  it('không dòng nào → chuỗi rỗng, không phải null', () => {
    expect(moTaLoiQc([])).toBe('');
  });

  it('ghi chú toàn khoảng trắng coi như không có', () => {
    expect(moTaLoiQc([{ lyDo: 'rach', ghiChu: '   ' }])).toBe('Rách');
  });
});
