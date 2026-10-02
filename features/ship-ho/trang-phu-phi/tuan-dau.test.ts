import { describe, it, expect } from 'vitest';
import { locTuanCoDon, type TuanDau } from './tuan-dau';

const t = (tu: string, den: string | null, phanTram: number): TuanDau => ({ tu, den, phanTram });
const HOM_NAY = '2026-10-02';

describe('locTuanCoDon', () => {
  /* Dữ liệu THẬT tháng 7/2026 của FedEx: 5 tuần liên tiếp, 38,5 → 38,25 → 38,5 → 39,75 → 44%.
     Brand chỉ gửi 1 đơn ngày 14/07 thì chỉ được thấy tuần chứa ngày đó. */
  it('chỉ giữ tuần chứa ngày gửi của brand', () => {
    const tuan = [
      t('2026-06-29', '2026-07-06', 38.5),
      t('2026-07-06', '2026-07-13', 38.25),
      t('2026-07-13', '2026-07-20', 38.5),
      t('2026-07-20', '2026-07-27', 39.75),
    ];
    expect(locTuanCoDon(tuan, ['2026-07-14'], HOM_NAY)).toEqual([t('2026-07-13', '2026-07-20', 38.5)]);
  });

  /* Khoảng nửa mở [tu, den): ngày gửi ĐÚNG bằng `den` thuộc tuần SAU. Sai một ngày ở đây là
     đưa brand mức của tuần khác làm căn cứ đối soát. */
  it('khoảng nửa mở: ngày bằng `den` thuộc tuần sau', () => {
    const tuan = [t('2026-07-06', '2026-07-13', 38.25), t('2026-07-13', '2026-07-20', 38.5)];
    expect(locTuanCoDon(tuan, ['2026-07-13'], HOM_NAY).map((x) => x.phanTram)).toEqual([38.5]);
    expect(locTuanCoDon(tuan, ['2026-07-06'], HOM_NAY).map((x) => x.phanTram)).toEqual([38.25]);
  });

  it('nhiều ngày gửi → nhiều tuần, mới nhất trên cùng', () => {
    const tuan = [
      t('2026-07-06', '2026-07-13', 38.25),
      t('2026-07-13', '2026-07-20', 38.5),
      t('2026-07-20', '2026-07-27', 39.75),
    ];
    expect(locTuanCoDon(tuan, ['2026-07-08', '2026-07-22'], HOM_NAY).map((x) => x.phanTram))
      .toEqual([39.75, 38.25]);
  });

  it('`den` null = mức đang mở, so tới hôm nay', () => {
    const tuan = [t('2026-09-28', null, 44)];
    expect(locTuanCoDon(tuan, ['2026-10-01'], HOM_NAY)).toHaveLength(1);
    expect(locTuanCoDon(tuan, ['2026-09-20'], HOM_NAY)).toHaveLength(0);
  });

  it('brand không có đơn → rỗng, KHÔNG trả cả bảng', () => {
    expect(locTuanCoDon([t('2026-07-06', '2026-07-13', 38.25)], [], HOM_NAY)).toEqual([]);
  });

  it('ngày gửi ngoài mọi tuần → rỗng', () => {
    expect(locTuanCoDon([t('2026-07-06', '2026-07-13', 38.25)], ['2026-01-01'], HOM_NAY)).toEqual([]);
  });

  it('không trả tuần trùng lặp khi nhiều đơn cùng tuần', () => {
    const tuan = [t('2026-07-06', '2026-07-13', 38.25)];
    expect(locTuanCoDon(tuan, ['2026-07-07', '2026-07-08', '2026-07-09'], HOM_NAY)).toHaveLength(1);
  });

  /* KHÔNG đụng mảng đầu vào: người gọi dùng lại danh sách tuần cho nhiều brand. */
  it('không sửa mảng đầu vào', () => {
    const tuan = [t('2026-07-06', '2026-07-13', 38.25), t('2026-06-29', '2026-07-06', 38.5)];
    const ban = [...tuan];
    locTuanCoDon(tuan, ['2026-07-07', '2026-06-30'], HOM_NAY);
    expect(tuan).toEqual(ban);
  });
});
