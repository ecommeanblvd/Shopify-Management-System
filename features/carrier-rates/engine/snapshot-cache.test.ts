import { describe, expect, it } from 'vitest';
import { taoBoNhoDem } from './snapshot-cache';

const boNho = (ttlMs = 1000) => {
  let moc = 0;
  const c = taoBoNhoDem<string>({ ttlMs, dongHo: () => moc });
  return { c, tien: (ms: number) => { moc += ms; }, dat: (ms: number) => { moc = ms; } };
};

describe('taoBoNhoDem', () => {
  it('lần đầu gọi hàm nạp, lần sau dùng lại kết quả', async () => {
    const { c } = boNho();
    let lanNap = 0;
    const nap = async () => { lanNap++; return 'A'; };
    expect(await c.lay('k', nap)).toBe('A');
    expect(await c.lay('k', nap)).toBe('A');
    expect(lanNap).toBe(1);
  });

  it('khoá khác nhau thì nạp riêng', async () => {
    const { c } = boNho();
    let lanNap = 0;
    const nap = async () => { lanNap++; return `giá-trị-${lanNap}`; };
    expect(await c.lay('a', nap)).toBe('giá-trị-1');
    expect(await c.lay('b', nap)).toBe('giá-trị-2');
    expect(lanNap).toBe(2);
  });

  it('quá hạn thì nạp lại', async () => {
    const { c, tien } = boNho(1000);
    let lanNap = 0;
    const nap = async () => { lanNap++; return `v${lanNap}`; };
    expect(await c.lay('k', nap)).toBe('v1');
    tien(999);
    expect(await c.lay('k', nap)).toBe('v1');
    tien(2);
    expect(await c.lay('k', nap)).toBe('v2');
  });

  it('xoá theo khoá buộc nạp lại đúng khoá đó, khoá khác giữ nguyên', async () => {
    const { c } = boNho();
    let lanNap = 0;
    const nap = async () => { lanNap++; return `v${lanNap}`; };
    await c.lay('a', nap);
    await c.lay('b', nap);
    c.xoa('a');
    expect(await c.lay('a', nap)).toBe('v3');
    expect(await c.lay('b', nap)).toBe('v2');
  });

  it('xoá không tham số thì dọn sạch', async () => {
    const { c } = boNho();
    let lanNap = 0;
    const nap = async () => { lanNap++; return `v${lanNap}`; };
    await c.lay('a', nap);
    await c.lay('b', nap);
    c.xoa();
    expect(c.soMuc()).toBe(0);
  });

  // Nếu lưu cả lỗi thì một trục trặc mạng thoáng qua sẽ bị đóng băng suốt TTL,
  // làm checkout mất giá của cả một carrier.
  it('hàm nạp ném lỗi thì KHÔNG lưu, lần sau thử lại', async () => {
    const { c } = boNho();
    await expect(c.lay('k', async () => { throw new Error('mạng lỗi'); })).rejects.toThrow('mạng lỗi');
    expect(c.soMuc()).toBe(0);
    expect(await c.lay('k', async () => 'ổn rồi')).toBe('ổn rồi');
  });

  // Chốt chặn tránh rò bộ nhớ khi khoá sinh ra vô hạn.
  it('vượt sức chứa thì bỏ mục cũ nhất', async () => {
    let moc = 0;
    const c = taoBoNhoDem<string>({ ttlMs: 10_000, sucChua: 2, dongHo: () => moc });
    await c.lay('a', async () => 'A'); moc += 1;
    await c.lay('b', async () => 'B'); moc += 1;
    await c.lay('c', async () => 'C');
    expect(c.soMuc()).toBe(2);
    let napLai = false;
    await c.lay('a', async () => { napLai = true; return 'A2'; });
    expect(napLai).toBe(true);
  });

  it('hai lời gọi song song cùng khoá chỉ nạp một lần', async () => {
    const { c } = boNho();
    let lanNap = 0;
    const nap = async () => { lanNap++; await new Promise((r) => setTimeout(r, 5)); return 'A'; };
    const [x, y] = await Promise.all([c.lay('k', nap), c.lay('k', nap)]);
    expect([x, y]).toEqual(['A', 'A']);
    expect(lanNap).toBe(1);
  });
});
