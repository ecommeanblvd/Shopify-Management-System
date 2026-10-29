import { describe, it, expect } from 'vitest';
import { gopDonChungKien } from './gop-don-chung-kien';

/** Các chùm, mỗi chùm là danh sách mã đã sắp — để so sánh không phụ thuộc mã đại diện. */
function chum(canh: ReadonlyArray<readonly [string, string]>): string[][] {
  const g = gopDonChungKien(canh);
  const theoGoc = new Map<string, string[]>();
  for (const [ma, goc] of g) {
    const a = theoGoc.get(goc) ?? [];
    a.push(ma);
    theoGoc.set(goc, a);
  }
  return [...theoGoc.values()].map((a) => a.sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

describe('gopDonChungKien', () => {
  it('không có cạnh nào thì không gộp gì', () => {
    expect(gopDonChungKien([]).size).toBe(0);
  });

  it('một kiện chở hai đơn ⇒ một chùm hai đơn', () => {
    expect(chum([['#A', '#B']])).toEqual([['#A', '#B']]);
  });

  it('một kiện chở BA đơn ⇒ một chùm ba đơn, không phải hai cặp rời', () => {
    // Caller sinh cạnh từ đơn gắn kiện tới từng mã còn lại trong kiện.
    expect(chum([['#A', '#B'], ['#A', '#C']])).toEqual([['#A', '#B', '#C']]);
  });

  it('hai kiện khác nhau chung một đơn ⇒ vẫn MỘT chùm', () => {
    // Đây là ca mà "ghép từng cặp" làm sai: #B–#C nối hai cặp lại thành một chùm bốn đơn.
    expect(chum([['#A', '#B'], ['#C', '#D'], ['#B', '#C']])).toEqual([['#A', '#B', '#C', '#D']]);
  });

  it('hai chùm rời thì vẫn rời, không dính vào nhau', () => {
    expect(chum([['#A', '#B'], ['#C', '#D']])).toEqual([['#A', '#B'], ['#C', '#D']]);
  });

  it('cạnh lặp và cạnh tự trỏ chính nó không làm vỡ chùm', () => {
    expect(chum([['#A', '#B'], ['#A', '#B'], ['#A', '#A']])).toEqual([['#A', '#B']]);
  });

  it('ĐẠI DIỆN không phụ thuộc thứ tự cạnh — cùng dữ liệu phải ra cùng kết quả', () => {
    const thuan = gopDonChungKien([['#A', '#B'], ['#B', '#C']]);
    const nguoc = gopDonChungKien([['#C', '#B'], ['#B', '#A']]);
    expect([...thuan.entries()].sort()).toEqual([...nguoc.entries()].sort());
    // và đại diện là mã nhỏ nhất của chùm
    expect(thuan.get('#C')).toBe('#A');
  });

  it('chùm dài 6 đơn nối thành chuỗi vẫn về một đại diện duy nhất', () => {
    const ma = ['#A', '#B', '#C', '#D', '#E', '#F'];
    const canh = ma.slice(1).map((m, i) => [ma[i], m] as const);
    const g = gopDonChungKien(canh);
    expect(new Set(ma.map((m) => g.get(m))).size).toBe(1);
  });
});
