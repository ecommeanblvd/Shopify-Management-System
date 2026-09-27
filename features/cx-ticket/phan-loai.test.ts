import { describe, it, expect } from 'vitest';
import {
  NHOM, BO_PHAN, nhomHopLe, loaiHopLe, nhanLoai, boPhanHopLe, nhanBoPhan, maTicket,
} from './phan-loai';

describe('phân loại ticket CX', () => {
  it('ba nhóm, đúng số loại đo được từ Lark', () => {
    expect(NHOM.map((n) => n.ma)).toEqual(['don_hang', 'truoc_khi_gui', 'su_co_van_chuyen']);
    expect(NHOM[0]!.loai).toHaveLength(12);
    expect(NHOM[1]!.loai).toHaveLength(2);
    expect(NHOM[2]!.loai).toHaveLength(4);
  });

  it('không có mã loại nào trùng trong cùng một nhóm', () => {
    for (const n of NHOM) {
      expect(new Set(n.loai.map((l) => l.ma)).size).toBe(n.loai.length);
    }
  });

  it('nhận nhóm hợp lệ, từ chối nhóm lạ', () => {
    expect(nhomHopLe('don_hang')).toBe(true);
    expect(nhomHopLe('Order Managerment Issue')).toBe(false);
    expect(nhomHopLe('')).toBe(false);
  });

  it('loại phải thuộc ĐÚNG nhóm đó', () => {
    expect(loaiHopLe('don_hang', 'het_hang')).toBe(true);
    expect(loaiHopLe('truoc_khi_gui', 'dia_chi_khong_hop_le')).toBe(true);
    // loại của nhóm khác — đúng kiểu rác cột Text 13 của Lark
    expect(loaiHopLe('don_hang', 'dia_chi_khong_hop_le')).toBe(false);
    expect(loaiHopLe('nhom_la', 'het_hang')).toBe(false);
  });

  it('nhãn ghép cả hai tầng', () => {
    expect(nhanLoai('don_hang', 'het_hang')).toBe('Vấn đề quản lý đơn · Hết hàng');
    expect(nhanLoai('su_co_van_chuyen', 'thong_quan')).toBe('Sự cố vận chuyển · Vướng thông quan');
  });

  it('nhãn không nổ khi mã lạ — dữ liệu cũ nhập từ Lark vẫn đọc được', () => {
    expect(nhanLoai('nhom_la', 'loai_la')).toBe('nhom_la · loai_la');
    expect(nhanLoai('don_hang', 'loai_la')).toBe('Vấn đề quản lý đơn');
  });

  it('sáu bộ phận, giữ nguyên mã Lark', () => {
    expect(BO_PHAN.map((b) => b.ma)).toEqual(
      ['CX-CS', 'MERCHANDISE', 'PROCUREMENT', 'DISCO-WH', 'DISCO-LOG', 'CHINA'],
    );
    expect(boPhanHopLe('PROCUREMENT')).toBe(true);
    expect(boPhanHopLe('procurement')).toBe(false);
    expect(nhanBoPhan('DISCO-WH')).toBe('Kho');
    expect(nhanBoPhan('LẠ')).toBe('LẠ');
  });

  it('mã ticket đệm 4 chữ số, quá 9999 thì dài ra', () => {
    expect(maTicket(1)).toBe('CXT-0001');
    expect(maTicket(676)).toBe('CXT-0676');
    expect(maTicket(12345)).toBe('CXT-12345');
  });
});
