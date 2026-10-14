import { describe, it, expect } from 'vitest';
import { tuTrongPhanTuNay, dongDuocXuLy } from './su-kien-trong-dong';

/** Phần tử giả: chỉ có đúng hai hàm mà luật dùng tới. */
type El = { contains(n: unknown): boolean; closest(sel: string): unknown };
/** `coViec` = phần tử mà `closest` trả về; đặt bằng chính dòng để dựng ca "dòng gặp chính nó". */
const el = (opts: { trong?: unknown[]; coViec?: unknown } = {}): El => ({
  contains: (n: unknown) => n === undefined || (opts.trong ?? []).includes(n),
  closest: (_sel: string) => opts.coViec ?? null,
});

describe('tuTrongPhanTuNay', () => {
  it('sự kiện phát từ TRONG phần tử → true', () => {
    const o = el(); const dong = el({ trong: [o] });
    expect(tuTrongPhanTuNay({ currentTarget: dong, target: o })).toBe(true);
  });
  it('sự kiện phát từ PORTAL, ngoài DOM của dòng → false', () => {
    const dong = el({ trong: [] });
    expect(tuTrongPhanTuNay({ currentTarget: dong, target: el() })).toBe(false);
  });
  it('không nhận diện được phần tử → KHÔNG chặn (thà mất một lớp còn hơn khoá nhầm)', () => {
    expect(tuTrongPhanTuNay({ currentTarget: null, target: null })).toBe(true);
    expect(tuTrongPhanTuNay({ currentTarget: 'x', target: 'y' })).toBe(true);
  });
});

describe('dongDuocXuLy', () => {
  it('bấm vùng trống trong dòng → dòng được xử', () => {
    const o = el(); const dong = el({ trong: [o] });
    expect(dongDuocXuLy({ currentTarget: dong, target: o })).toBe(true);
  });
  it('bấm vào NÚT nằm trong dòng → dòng không giành cú bấm', () => {
    const nut: El = el(); const dong = el({ trong: [nut] });
    (nut as { closest: (s: string) => unknown }).closest = () => nut;
    expect(dongDuocXuLy({ currentTarget: dong, target: nut })).toBe(false);
  });
  it('dòng mang role="link" tự gặp CHÍNH NÓ → vẫn phải mở được (lỗi 14/10/2026)', () => {
    const o: El = el();
    const dong: El = el({ trong: [o] });
    // `closest` từ ô leo lên gặp chính cái dòng — không được coi là "đã có người lo".
    (o as { closest: (s: string) => unknown }).closest = () => dong;
    expect(dongDuocXuLy({ currentTarget: dong, target: o })).toBe(true);
  });
  it('sự kiện từ portal → dòng KHÔNG được xử, dù không phải nút', () => {
    expect(dongDuocXuLy({ currentTarget: el({ trong: [] }), target: el() })).toBe(false);
  });
});
