import { describe, it, expect } from 'vitest';
import { phanLoaiAwb, moTaPhanLoai } from './awb-ship-ho';

const store = new Set(['111']);
const shipHo = new Set(['222', '333']);

describe('phanLoaiAwb', () => {
  it('tách ba nhóm — ship hộ KHÔNG phải lỗi', () => {
    /* Ca thật 30/09: hai tờ duty ship hộ vào hệ thống, màn báo "0/2" nên Đức nghĩ hỏng và
       1.065.043đ nằm im. "Không khớp" đã gộp "hệ thống có biết" với "không biết là gì". */
    const r = phanLoaiAwb(['111', '222', '999'], store, shipHo);
    expect(r).toEqual({ khopStore: ['111'], laShipHo: ['222'], khongBiet: ['999'] });
  });

  it('KHÔNG khử trùng lặp — một mã hai dòng là chuyện thật (cước và duty tách dòng)', () => {
    const r = phanLoaiAwb(['222', '222'], store, shipHo);
    expect(r.laShipHo).toEqual(['222', '222']);
  });

  it('tổng ba nhóm luôn bằng số DÒNG, để con số khớp với thứ người dùng nhìn thấy', () => {
    const awbs = ['111', '222', '333', '999', '888', '111'];
    const r = phanLoaiAwb(awbs, store, shipHo);
    expect(r.khopStore.length + r.laShipHo.length + r.khongBiet.length).toBe(awbs.length);
  });

  it('mã có ở CẢ HAI bảng tính là store, không đếm hai lần', () => {
    const r = phanLoaiAwb(['111'], new Set(['111']), new Set(['111']));
    expect(r.khopStore).toEqual(['111']);
    expect(r.laShipHo).toEqual([]);
  });

  it('nhận cả Map (resolveAwbMap trả Map) chứ không chỉ Set', () => {
    const r = phanLoaiAwb(['111'], new Map([['111', 'id-1']]), new Set());
    expect(r.khopStore).toEqual(['111']);
  });
});

describe('moTaPhanLoai — nói VIỆC PHẢI LÀM, không chỉ con số', () => {
  it('nêu đủ ba nhóm khi có cả ba', () => {
    const s = moTaPhanLoai(phanLoaiAwb(['111', '222', '999'], store, shipHo));
    expect(s).toContain('1/3 dòng khớp kiện của store');
    expect(s).toContain('1 dòng là đơn SHIP HỘ');
    expect(s).toContain('1 dòng KHÔNG tìm thấy');
  });

  it('không nhắc nhóm rỗng — câu về 0 dòng chỉ là nhiễu', () => {
    const s = moTaPhanLoai(phanLoaiAwb(['111'], store, shipHo));
    expect(s).toBe('1/1 dòng khớp kiện của store');
  });

  it('ca của Đức: 0 khớp store nhưng 2 dòng ship hộ — KHÔNG được đọc thành hỏng', () => {
    const s = moTaPhanLoai(phanLoaiAwb(['222', '333'], store, shipHo));
    expect(s).toContain('0/2 dòng khớp kiện của store');
    expect(s).toContain('2 dòng là đơn SHIP HỘ');
  });
});
