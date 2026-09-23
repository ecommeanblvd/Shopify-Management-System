import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loiRefreshFuel, type KetQuaRefreshFuel } from './refresh-all';
import { AUTO_FUEL_CARRIER_KEYS } from './manual-fuel-staleness';

function kq(over: Partial<KetQuaRefreshFuel> = {}): KetQuaRefreshFuel {
  return { tong: 4, thanhCong: 4, hong: [], quaHan: [], ketQua: [], ...over };
}

describe('loiRefreshFuel', () => {
  it('mọi hãng ổn → không có lỗi', () => {
    expect(loiRefreshFuel(kq())).toBeNull();
  });

  it('một hãng fetch lỗi → có lỗi VÀ gọi tên hãng đó', () => {
    const loi = loiRefreshFuel(kq({
      thanhCong: 3,
      hong: ['[ups] UPS Worldwide Expedited: fetchUpsFuelWeeks: assets.ups.com returned 404'],
    }));
    expect(loi).not.toBeNull();
    expect(loi).toContain('ups');
    expect(loi).toContain('UPS Worldwide Expedited');
    expect(loi).toContain('404');
    expect(loi).toContain('1/4');
  });

  it('hãng chạy xong nhưng giá quá cũ vẫn thành lỗi — nguồn tự chết là im lặng nhất', () => {
    const loi = loiRefreshFuel(kq({
      quaHan: ['[dhl] DHL Express Vietnam: tuần mới nhất đã 79 ngày tuổi'],
    }));
    expect(loi).not.toBeNull();
    expect(loi).toContain('dhl');
    expect(loi).toContain('79 ngày');
  });

  it('gộp cả hai loại lỗi vào một câu', () => {
    const loi = loiRefreshFuel(kq({ hong: ['[ups] A: x'], quaHan: ['[dhl] B: y'] }));
    expect(loi).toContain('ups');
    expect(loi).toContain('dhl');
  });
});

/**
 * Canh chính cái lỗi đã xảy ra: route HTTP và script cron mỗi bên chép một danh
 * sách hãng riêng rồi lệch nhau, khiến UPS + SF Express không bao giờ được gọi
 * mà tác vụ vẫn báo xanh suốt 11 tuần. Cả hai đường vào PHẢI đi qua bộ chạy
 * chung và KHÔNG được nhắc tên hãng nào trong mã của chính nó.
 */
describe('hai đường vào refresh-fuel không được chép danh sách hãng', () => {
  const FILES = [
    join(process.cwd(), 'app/api/cron/refresh-fuel/route.ts'),
    join(process.cwd(), 'scripts/cron/refresh-fedex-fuel.ts'),
  ];

  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    // Bỏ phần chú thích: sự cố được KỂ LẠI trong comment, không phải mã chạy.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it(`${f} dùng bộ chạy chung chayRefreshFuel`, () => {
      expect(code).toContain('chayRefreshFuel');
    });

    for (const key of AUTO_FUEL_CARRIER_KEYS) {
      it(`${f} không hardcode khoá hãng '${key}'`, () => {
        expect(code).not.toContain(`'${key}'`);
        expect(code).not.toContain(`"${key}"`);
      });
    }

    it(`${f} đánh dấu lượt chạy HỎNG khi có hãng lỗi (truyền kiemTra/loiRefreshFuel)`, () => {
      expect(code).toContain('loiRefreshFuel');
    });
  }
});
