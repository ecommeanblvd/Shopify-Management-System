import { describe, it, expect } from 'vitest';
import { tuTrongPhanTuNay, dongDuocXuLy } from './su-kien-trong-dong';

/** Phần tử giả: chỉ có đúng hai hàm mà luật dùng tới. */
const el = (opts: { trong?: unknown[]; laNut?: boolean } = {}) => ({
  contains: (n: unknown) => n === undefined || (opts.trong ?? []).includes(n),
  closest: (_sel: string) => (opts.laNut ? {} : null),
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
    const nut = el({ laNut: true }); const dong = el({ trong: [nut] });
    expect(dongDuocXuLy({ currentTarget: dong, target: nut })).toBe(false);
  });
  it('sự kiện từ portal → dòng KHÔNG được xử, dù không phải nút', () => {
    expect(dongDuocXuLy({ currentTarget: el({ trong: [] }), target: el() })).toBe(false);
  });
});
