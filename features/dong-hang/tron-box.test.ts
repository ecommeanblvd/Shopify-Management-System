import { describe, it, expect } from 'vitest';
import { tronBox } from './tron-box';
import { Box } from './danh-muc-box';
import { BoxSms } from './tron-box';

describe('tronBox', () => {
  it('box chưa ai sửa → lấy số của Lark, lech null', () => {
    const tuLark: Box[] = [
      {
        ten: 'Thùng Carton 5kg',
        ma: 'M1',
        loai: 'thung',
        kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 28 },
        larkRecordIds: ['r1'],
      },
    ];
    const tuSms: BoxSms[] = [
      {
        id: 'x',
        ten: 'Thùng Carton 5kg',
        ma: 'M1',
        loai: 'thung',
        // Số cũ do SMS lưu từ lần đồng bộ trước — chưa ai khoá, nên Lark vẫn thắng.
        daiCm: 40,
        rongCm: 25,
        caoCm: 20,
        suaTay: false,
        an: false,
      },
    ];

    const r = tronBox(tuLark, tuSms);

    expect(r).toHaveLength(1);
    expect(r[0].kichThuoc).toEqual({ daiCm: 40, rongCm: 25, caoCm: 28 });
    expect(r[0].lech).toBeNull();
    expect(r[0].suaTay).toBe(false);
  });

  it('box Lark có, SMS KHÔNG có dòng nào cho nó → hiện nguyên số Lark, chưa khoá', () => {
    const tuLark: Box[] = [
      {
        ten: 'Thùng Mới Về Lần Đầu',
        ma: 'M-NEW',
        loai: 'thung',
        kichThuoc: { daiCm: 45, rongCm: 30, caoCm: 22 },
        larkRecordIds: ['r1'],
      },
    ];

    const r = tronBox(tuLark, []);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      ten: 'Thùng Mới Về Lần Đầu',
      ma: 'M-NEW',
      loai: 'thung',
      kichThuoc: { daiCm: 45, rongCm: 30, caoCm: 22 },
      larkRecordIds: ['r1'],
      id: null,
      suaTay: false,
      an: false,
      lech: null,
    });
  });

  it('box ĐÃ sửa tay → giữ số SMS, Lark đổi chỉ hiện lech', () => {
    const r = tronBox(
      [{ ten: 'Thùng Carton 5kg', ma: 'M1', loai: 'thung', kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 28 }, larkRecordIds: ['r1'] }],
      [{ id: 'x', ten: 'Thùng Carton 5kg', ma: 'M1', loai: 'thung', daiCm: 40, rongCm: 25, caoCm: 30, suaTay: true, an: false }],
    );
    expect(r[0].kichThuoc).toEqual({ daiCm: 40, rongCm: 25, caoCm: 30 });
    expect(r[0].lech).toEqual({ daiCm: 40, rongCm: 25, caoCm: 28 });
  });

  it('box đã sửa tay nhưng Lark KHÔNG đổi → lech null (không có gì để báo)', () => {
    const r = tronBox(
      [{ ten: 'Thùng Carton 5kg', ma: 'M1', loai: 'thung', kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 30 }, larkRecordIds: ['r1'] }],
      [{ id: 'x', ten: 'Thùng Carton 5kg', ma: 'M1', loai: 'thung', daiCm: 40, rongCm: 25, caoCm: 30, suaTay: true, an: false }],
    );
    expect(r[0].kichThuoc).toEqual({ daiCm: 40, rongCm: 25, caoCm: 30 });
    expect(r[0].lech).toBeNull();
  });

  it('box đã khoá, Lark đổi cả ma/loai → kết quả giữ ma/loai/kích thước của SMS, lech báo số Lark', () => {
    const r = tronBox(
      [
        {
          ten: 'Thùng Carton 5kg',
          // Lark đã đổi mã và loại sau khi người khoá kích thước — không được ghép mã
          // mới với số đo cũ, vì chữ trong `ma` quyết định tính phí BOX/PAK/BAG.
          ma: 'M2-PAK',
          loai: 'tui',
          kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 32 },
          larkRecordIds: ['r1'],
        },
      ],
      [
        {
          id: 'x',
          ten: 'Thùng Carton 5kg',
          ma: 'M1-BOX',
          loai: 'thung',
          daiCm: 40,
          rongCm: 25,
          caoCm: 28,
          suaTay: true,
          an: false,
        },
      ],
    );

    expect(r).toHaveLength(1);
    expect(r[0].ma).toBe('M1-BOX');
    expect(r[0].loai).toBe('thung');
    expect(r[0].kichThuoc).toEqual({ daiCm: 40, rongCm: 25, caoCm: 28 });
    expect(r[0].lech).not.toBeNull();
  });

  it('box Lark đã xoá mà SMS đã sở hữu → VẪN còn trong danh sách', () => {
    const tuSms: BoxSms[] = [
      {
        id: 'x',
        ten: 'Thùng Carton Lô Cũ',
        ma: 'M9',
        loai: 'thung',
        daiCm: 35,
        rongCm: 20,
        caoCm: 15,
        suaTay: true,
        an: false,
      },
    ];

    const r = tronBox([], tuSms);

    expect(r).toHaveLength(1);
    expect(r[0].ten).toBe('Thùng Carton Lô Cũ');
    expect(r[0].kichThuoc).toEqual({ daiCm: 35, rongCm: 20, caoCm: 15 });
    expect(r[0].larkRecordIds).toEqual([]);
    expect(r[0].id).toBe('x');
    expect(r[0].lech).toBeNull();
  });

  it('box chỉ có trong SMS (người tự thêm) vẫn hiện', () => {
    const tuSms: BoxSms[] = [
      {
        id: 'y',
        ten: 'Thùng Đặc Biệt Tự Thêm',
        ma: 'M-DIY',
        loai: 'thung',
        daiCm: 50,
        rongCm: 30,
        caoCm: 20,
        suaTay: false,
        an: false,
      },
    ];

    const r = tronBox([], tuSms);

    expect(r).toHaveLength(1);
    expect(r[0].ten).toBe('Thùng Đặc Biệt Tự Thêm');
    expect(r[0].kichThuoc).toEqual({ daiCm: 50, rongCm: 30, caoCm: 20 });
    expect(r[0].id).toBe('y');
  });

  it('box bị ẩn không biến mất, chỉ mang cờ an=true', () => {
    const tuLark: Box[] = [
      {
        ten: 'Thùng Ngừng Dùng',
        ma: 'M-OLD',
        loai: 'thung',
        kichThuoc: { daiCm: 40, rongCm: 25, caoCm: 28 },
        larkRecordIds: ['r1'],
      },
    ];
    const tuSms: BoxSms[] = [
      {
        id: 'z',
        ten: 'Thùng Ngừng Dùng',
        ma: 'M-OLD',
        loai: 'thung',
        daiCm: 40,
        rongCm: 25,
        caoCm: 28,
        suaTay: false,
        an: true,
      },
    ];

    const r = tronBox(tuLark, tuSms);

    expect(r).toHaveLength(1);
    expect(r[0].an).toBe(true);
  });
});
