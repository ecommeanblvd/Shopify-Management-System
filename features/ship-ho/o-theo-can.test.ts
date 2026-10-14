import { describe, it, expect } from 'vitest';
import { oTheoCan } from './o-theo-can';

const cells = [
  { kg: 0.5, loaiGoi: 'package', vnd: 500_000 },
  { kg: 1.0, loaiGoi: 'package', vnd: 700_000 },
  { kg: 1.5, loaiGoi: 'package', vnd: 900_000 },
  { kg: 2.0, loaiGoi: 'package', vnd: 1_100_000 },
  { kg: 1.0, loaiGoi: 'pak', vnd: 650_000 },
];

describe('oTheoCan', () => {
  it('cân nằm giữa hai bậc → LÀM TRÒN LÊN bậc phủ được nó', () => {
    expect(oTheoCan(cells, 1.7)).toMatchObject({ kg: 2.0, vnd: 1_100_000 });
    expect(oTheoCan(cells, 0.6)).toMatchObject({ kg: 1.0, vnd: 700_000 });
  });
  it('cân đúng bằng một bậc → lấy CHÍNH bậc đó, không nhảy lên bậc trên', () => {
    expect(oTheoCan(cells, 1.5)).toMatchObject({ kg: 1.5, vnd: 900_000 });
    expect(oTheoCan(cells, 2.0)).toMatchObject({ kg: 2.0, vnd: 1_100_000 });
  });
  it('số thập phân lẻ bit (1,5 lưu thành 1,4999…) vẫn ra đúng bậc 1,5', () => {
    expect(oTheoCan(cells, 1.49999)).toMatchObject({ kg: 1.5 });
    expect(oTheoCan(cells, 1.50001)).toMatchObject({ kg: 1.5 });
  });
  it('vượt bậc cao nhất → null, KHÔNG rơi về bậc gần nhất', () => {
    expect(oTheoCan(cells, 2.5)).toBeNull();
  });
  it('lọc đúng loại gói, không lẫn pak sang package', () => {
    expect(oTheoCan(cells, 0.9)).toMatchObject({ loaiGoi: 'package', vnd: 700_000 });
    expect(oTheoCan(cells, 0.9, 'pak')).toMatchObject({ loaiGoi: 'pak', vnd: 650_000 });
    expect(oTheoCan(cells, 1.2, 'pak')).toBeNull();
  });
  it('cân không hợp lệ → null', () => {
    for (const x of [0, -1, Number.NaN]) expect(oTheoCan(cells, x)).toBeNull();
  });
  it('bảng giá rỗng → null', () => { expect(oTheoCan([], 1)).toBeNull(); });
});
