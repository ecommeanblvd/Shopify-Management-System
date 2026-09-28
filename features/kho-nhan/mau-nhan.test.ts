import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mauKho, mauLoaiNhap, KHO_THAT, LOAI_NHAP_THAT } from './mau-nhan';

describe('mauKho', () => {
  it('ba kho thật, mỗi kho một màu riêng', () => {
    const mau = KHO_THAT.map(mauKho);
    expect(new Set(mau).size).toBe(KHO_THAT.length);
  });

  it('hai kho SG cùng họ màu lạnh xanh, HN khác hẳn — đọc ra thành phố trước khi đọc chữ', () => {
    expect(mauKho('SG | AP')).toContain('cyan');
    expect(mauKho('SG | DM')).toContain('blue');
    expect(mauKho('HN | GVM')).toContain('violet');
  });

  it('kho lạ / rỗng → màu trung tính, KHÔNG mượn màu đang mang nghĩa khác', () => {
    for (const v of [null, '', '   ', 'SG | XYZ']) {
      const m = mauKho(v);
      expect(m).toContain('muted');
      expect(KHO_THAT.map(mauKho)).not.toContain(m);
    }
  });
});

describe('mauLoaiNhap', () => {
  it('mười bốn loại thật, mỗi loại một màu riêng', () => {
    const mau = LOAI_NHAP_THAT.map(mauLoaiNhap);
    expect(new Set(mau).size).toBe(LOAI_NHAP_THAT.length);
  });

  it('Retail chiếm 76% dòng nên phải LẶNG — màu ồn trên 3/4 bảng không nói gì', () => {
    expect(mauLoaiNhap('Retail')).toContain('slate');
    expect(mauLoaiNhap('Retail (order before 8.24)')).toContain('zinc');
  });

  it('cùng họ "Tồn kho" thì màu KHÁC nhau nhưng nằm cạnh nhau trên vành màu', () => {
    const ho = ['Tồn kho (Consignment)', 'Tồn kho (PO)', 'Tồn kho (Return)'].map(mauLoaiNhap);
    expect(new Set(ho).size).toBe(3);
    expect(ho[0]).toContain('amber');
    expect(ho[1]).toContain('orange');
    expect(ho[2]).toContain('yellow');
  });

  it('đỏ DÀNH RIÊNG cho "Đồ lỗi (k bán)" — trùng nghĩa với tint dòng QC hỏng', () => {
    expect(mauLoaiNhap('Đồ lỗi (k bán)')).toContain('red');
    const do_ = LOAI_NHAP_THAT.filter((v) => v !== 'Đồ lỗi (k bán)').map(mauLoaiNhap)
      .filter((m) => /\bred-/.test(m));
    expect(do_).toEqual([]);
  });

  it('KHÔNG dùng emerald — emerald đang là nhãn nguồn "Hệ thống"', () => {
    for (const m of LOAI_NHAP_THAT.map(mauLoaiNhap)) expect(m).not.toContain('emerald');
    for (const m of KHO_THAT.map(mauKho)) expect(m).not.toContain('emerald');
  });

  it('loại lạ (Lark thêm loại mới) → trung tính, không mượn màu của loại đã có', () => {
    for (const v of [null, '', 'Loại Lark vừa thêm']) {
      const m = mauLoaiNhap(v);
      expect(m).toContain('muted');
      expect(LOAI_NHAP_THAT.map(mauLoaiNhap)).not.toContain(m);
    }
  });

  it('bỏ khoảng trắng hai đầu — Lark hay để lọt dấu cách', () => {
    expect(mauLoaiNhap('  Retail  ')).toBe(mauLoaiNhap('Retail'));
    expect(mauKho(' HN | GVM ')).toBe(mauKho('HN | GVM'));
  });

  it('mọi màu đều có cặp sáng/tối — bảng dùng được cả hai chế độ', () => {
    for (const m of [...LOAI_NHAP_THAT.map(mauLoaiNhap), ...KHO_THAT.map(mauKho)]) {
      expect(m).toMatch(/dark:/);
    }
  });
});

describe('luật Tailwind 4: class phải là chuỗi LITERAL', () => {
  it('mau-nhan.ts không ghép class bằng template literal — Tailwind quét source, class ghép lúc chạy không có CSS', () => {
    const src = readFileSync(new URL('./mau-nhan.ts', import.meta.url), 'utf8');
    const ghep = src.match(/(bg|text|border|ring)-\$\{|\$\{[^}]*\}-(500|600|700|800)/g);
    expect(ghep).toBeNull();
  });

  it('mọi class màu trả về đều khớp dạng Tailwind tĩnh', () => {
    for (const m of [...LOAI_NHAP_THAT.map(mauLoaiNhap), ...KHO_THAT.map(mauKho)]) {
      expect(m).toMatch(/^bg-[a-z]+-500\/15 text-[a-z]+-[678]00 dark:text-[a-z]+-[34]00$/);
    }
  });
});
