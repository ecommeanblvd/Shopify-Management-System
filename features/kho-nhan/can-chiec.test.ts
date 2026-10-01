import { describe, it, expect } from 'vitest';
import { docCanNhap } from './can-chiec';
import { CAN_TOI_DA_KG } from './can-tu-lark';

describe('docCanNhap', () => {
  it('số thường', () => expect(docCanNhap('1.5')).toEqual({ ok: true, kg: 1.5 }));

  it('để TRỐNG là xoá cân, không phải lỗi — CEO cho phép bổ sung sau nên cũng phải cho rút lại', () => {
    expect(docCanNhap('')).toEqual({ ok: true, kg: null });
    expect(docCanNhap('   ')).toEqual({ ok: true, kg: null });
    expect(docCanNhap(null)).toEqual({ ok: true, kg: null });
  });

  it('dấu phẩy thập phân (bàn phím tiếng Việt) vẫn nhận', () => {
    expect(docCanNhap('1,25')).toEqual({ ok: true, kg: 1.25 });
  });

  it('làm tròn 3 số lẻ đúng bằng độ chính xác của cột', () => {
    expect(docCanNhap('1.23456')).toEqual({ ok: true, kg: 1.235 });
  });

  it('0 và số âm bị từ chối', () => {
    expect(docCanNhap('0').ok).toBe(false);
    expect(docCanNhap('-2').ok).toBe(false);
  });

  it(`trên ${CAN_TOI_DA_KG} kg bị từ chối — gõ thừa số 0 hoặc gõ gam vào ô ki-lô`, () => {
    expect(docCanNhap(String(CAN_TOI_DA_KG + 0.001)).ok).toBe(false);
    expect(docCanNhap('1500').ok).toBe(false);
    expect(docCanNhap(String(CAN_TOI_DA_KG))).toEqual({ ok: true, kg: CAN_TOI_DA_KG });
  });

  it('chữ không phải số → báo lỗi, KHÔNG âm thầm thành null', () => {
    expect(docCanNhap('abc')).toEqual({ ok: false, loi: 'Cân phải là số' });
  });

  it('cùng ngưỡng với đường Lark — hai đường vào một cột không được khác luật', () => {
    expect(docCanNhap('51').ok).toBe(false);
  });
});
