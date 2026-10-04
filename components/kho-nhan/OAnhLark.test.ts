import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OAnhLark } from './OAnhLark';
import type { FileLark } from '@/features/kho-nhan/types';

const ve = (ds: FileLark[]) =>
  renderToStaticMarkup(createElement(OAnhLark, { ds, nhan: 'Ảnh lỗi QC · #MBLVD1' }));

const anh = (n: number): FileLark[] =>
  Array.from({ length: n }, (_, i) => ({ token: `tk${i}`, ten: `a${i}.jpg` }));

/** Mép tấm xếp chồng phía sau — đếm bằng số lớp `aria-hidden`. */
const soLopSau = (html: string) => (html.match(/aria-hidden/g) ?? []).length;

describe('OAnhLark — ô đính kèm trên bảng', () => {
  it('không file nào thì chỉ gạch ngang', () => {
    expect(ve([])).toContain('—');
  });

  /* CEO 04/10/2026: chữ "+2" cạnh ảnh làm ô rộng hơn ô một ảnh nên cả cột lệch. */
  it('KHÔNG bày số file cạnh ảnh', () => {
    expect(ve(anh(3))).not.toContain('+2');
  });

  it('một file thì không có lớp nào phía sau', () => {
    expect(soLopSau(ve(anh(1)))).toBe(0);
  });

  it('hai file thì hé ra một mép, ba file trở lên thì hai mép', () => {
    expect(soLopSau(ve(anh(2)))).toBe(1);
    expect(soLopSau(ve(anh(3)))).toBe(2);
    expect(soLopSau(ve(anh(9)))).toBe(2);   // nhiều hơn nữa vẫn hai mép, không dày thêm
  });

  /* Khung ngoài cố định 32px dù mấy file — đây mới là thứ giữ cột thẳng hàng. */
  it('khung ngoài luôn cùng kích thước', () => {
    for (const n of [1, 2, 5]) expect(ve(anh(n))).toContain('relative block size-8');
  });

  it('số file vẫn đọc được — thông tin không mất, chỉ thôi chiếm chỗ', () => {
    const html = ve(anh(3));
    expect(html).toContain('title="3 file');
    expect(html).toContain('3 file"');
  });

  /* CEO 04/10/2026: tấm sau phải là ảnh THẬT, không phải ô xám. */
  it('tấm phía sau là ảnh thật của tệp thứ hai và thứ ba', () => {
    const html = ve(anh(3));
    for (const t of ['tk0', 'tk1', 'tk2']) expect(html).toContain(`/api/kho-nhan/anh-lark/${t}?w=56`);
  });

  it('chỉ tấm ĐẦU mang nhãn cho trình đọc màn hình, tấm sau bị ẩn', () => {
    const html = ve(anh(3));
    expect(html.match(/alt="Ảnh lỗi QC · #MBLVD1"/g) ?? []).toHaveLength(1);
    expect(html.match(/alt=""/g) ?? []).toHaveLength(2);
  });

  it('tệp đầu là PDF thì vẽ nhãn PDF, tấm sau vẫn là ảnh thật', () => {
    const html = ve([{ token: 'p1', ten: 'bb.pdf' }, { token: 'a1', ten: 'a.jpg' }]);
    expect(html).toContain('PDF');
    expect(html).toContain('/api/kho-nhan/anh-lark/a1?w=56');
  });
});
