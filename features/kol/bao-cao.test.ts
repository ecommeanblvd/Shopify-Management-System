import { describe, it, expect } from 'vitest';
import { gomTheoThang, gomTheoNguoiNhan, quyVeVnd } from './bao-cao';
import type { DongDon } from './types';

const base: DongDon = {
  id: 'x', sku: 'A-1', tenHang: null, kho: 'GVM', soLuong: 1, hinhThuc: 'tang',
  hanTra: null, giaVon: '100', giaVonTienTe: 'VND', soLuongDaTra: 0, soLuongNhapLai: 0,
};

describe('gomTheoThang', () => {
  it('gom theo tháng của ngày gửi, sắp xếp tháng mới nhất trước', () => {
    const r = gomTheoThang([
      { ...base, guiLuc: '2026-09-10T00:00:00Z', soLuong: 2 },
      { ...base, guiLuc: '2026-08-05T00:00:00Z', soLuong: 1 },
      { ...base, guiLuc: '2026-09-20T00:00:00Z', soLuong: 3 },
    ]);
    expect(r.map((x) => x.khoa)).toEqual(['2026-09', '2026-08']);
    expect(r[0].theoTienTe).toEqual({ VND: 500 });
    expect(r[1].theoTienTe).toEqual({ VND: 100 });
  });
  it('dòng chưa gửi gom vào khoá "chua_gui", KHÔNG bị bỏ im lặng', () => {
    const r = gomTheoThang([{ ...base, guiLuc: null }]);
    expect(r.map((x) => x.khoa)).toEqual(['chua_gui']);
  });
  it('"chua_gui" luôn xếp CUỐI, không nhảy lên trên tháng mới nhất', () => {
    // So sánh chuỗi ngây thơ xếp 'chua_gui' > mọi 'YYYY-MM' (chữ 'c' > chữ số) —
    // bug đã sửa ở fix round 1. Test này khoá lại hành vi đúng.
    const r = gomTheoThang([
      { ...base, guiLuc: null },
      { ...base, guiLuc: '2026-08-05T00:00:00Z' },
      { ...base, guiLuc: '2026-09-10T00:00:00Z' },
    ]);
    expect(r.map((x) => x.khoa)).toEqual(['2026-09', '2026-08', 'chua_gui']);
  });
});

describe('gomTheoNguoiNhan', () => {
  it('cộng dồn theo NGƯỜI (id) và đếm riêng dòng thiếu giá vốn', () => {
    const r = gomTheoNguoiNhan([
      { ...base, nguoiNhanId: 'id-mai', tenNhan: 'Mai', tenNhanHienTai: 'Mai', soLuong: 2 },
      { ...base, nguoiNhanId: 'id-mai', tenNhan: 'Mai', tenNhanHienTai: 'Mai', giaVon: null },
      { ...base, nguoiNhanId: 'id-lan', tenNhan: 'Lan', tenNhanHienTai: 'Lan', soLuong: 1 },
    ]);
    const mai = r.find((x) => x.khoa === 'id-mai')!;
    expect(mai.nhan).toBe('Mai');
    expect(mai.theoTienTe).toEqual({ VND: 200 });
    expect(mai.soDongThieuGiaVon).toBe(1);
    expect(r.find((x) => x.khoa === 'id-lan')!.theoTienTe).toEqual({ VND: 100 });
  });

  it('HAI người TRÙNG TÊN không bị gộp thành một dòng', () => {
    // Sổ KOL không có ràng buộc duy nhất trên tên. Gom theo tên thì hai người
    // khác nhau tên "Mai Anh" hoà làm một, và không có gì báo cho người đọc.
    const r = gomTheoNguoiNhan([
      { ...base, nguoiNhanId: 'id-1', tenNhan: 'Mai Anh', tenNhanHienTai: 'Mai Anh', soLuong: 2 },
      { ...base, nguoiNhanId: 'id-2', tenNhan: 'Mai Anh', tenNhanHienTai: 'Mai Anh', soLuong: 5 },
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.khoa).sort()).toEqual(['id-1', 'id-2']);
    expect(r.find((x) => x.khoa === 'id-1')!.theoTienTe).toEqual({ VND: 200 });
    expect(r.find((x) => x.khoa === 'id-2')!.theoTienTe).toEqual({ VND: 500 });
  });

  it('MỘT người ĐỔI TÊN vẫn là một dòng, hiện tên HIỆN TẠI', () => {
    // `tenNhan` là ảnh chụp lúc tạo đơn (cố ý, để đơn cũ đọc đúng lịch sử) nên
    // đổi tên trong sổ làm cùng một người tách thành hai dòng nửa vời.
    const r = gomTheoNguoiNhan([
      { ...base, nguoiNhanId: 'id-1', tenNhan: 'Mai (cũ)', tenNhanHienTai: 'Mai Nguyễn', soLuong: 2 },
      { ...base, nguoiNhanId: 'id-1', tenNhan: 'Mai Nguyễn', tenNhanHienTai: 'Mai Nguyễn', soLuong: 3 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].khoa).toBe('id-1');
    expect(r[0].nhan).toBe('Mai Nguyễn');
    expect(r[0].theoTienTe).toEqual({ VND: 500 });
  });

  it('không tra được tên hiện tại thì rớt về ảnh chụp trên đơn, không hiện id trần', () => {
    const r = gomTheoNguoiNhan([
      { ...base, nguoiNhanId: 'id-1', tenNhan: 'Mai', tenNhanHienTai: null },
    ]);
    expect(r[0].nhan).toBe('Mai');
  });

  it('vẫn xếp theo VND giảm dần', () => {
    const r = gomTheoNguoiNhan([
      { ...base, nguoiNhanId: 'id-it', tenNhan: 'Ít', tenNhanHienTai: 'Ít', soLuong: 1 },
      { ...base, nguoiNhanId: 'id-nhieu', tenNhan: 'Nhiều', tenNhanHienTai: 'Nhiều', soLuong: 9 },
    ]);
    expect(r.map((x) => x.khoa)).toEqual(['id-nhieu', 'id-it']);
  });
});

describe('quyVeVnd', () => {
  const rates = [{ from: 'USD', to: 'VND', period: '2026-09', rate: 25000 }];
  it('VND giữ nguyên, không cần tỷ giá', () => {
    expect(quyVeVnd({ VND: 500 }, '2026-09', [])).toEqual({ vnd: 500, khongDoiDuoc: [] });
  });
  it('USD quy đổi theo tỷ giá đúng tháng', () => {
    expect(quyVeVnd({ VND: 500, USD: 4 }, '2026-09', rates)).toEqual({ vnd: 100500, khongDoiDuoc: [] });
  });
  it('thiếu tỷ giá thì KHÔNG cộng bừa, mà kê tên loại tiền không đổi được', () => {
    const r = quyVeVnd({ VND: 500, USD: 4 }, '2026-10', rates);
    expect(r.vnd).toBe(500);
    expect(r.khongDoiDuoc).toEqual(['USD']);
  });
});
