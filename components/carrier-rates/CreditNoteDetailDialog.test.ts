import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditNoteDetailDialog } from './CreditNoteDetailDialog';

const dong = (i: number) => ({
  id: String(i), soHoaDon: String(460 + i), kyHieu: '1K26THA', ngay: '2026-08-27',
  tongCong: 3_453_840, soDong: 0, tenFile: `${1460 + i}.xml`, loai: 'credit' as const,
});
const thang = [{ thang: '2026-08', tong: 50_676_806, n: 10, tongDebit: 0, nDebit: 0 }];

describe('CreditNoteDetailDialog — dòng tóm tắt', () => {
  it('chỉ hiện một dòng tóm tắt, KHÔNG trải bảng chứng từ ra trang', () => {
    const html = renderToStaticMarkup(createElement(CreditNoteDetailDialog, { rows: [1, 2, 3].map(dong), tongThang: thang }));
    expect(html).toContain('Hoá đơn điều chỉnh carrier');
    expect(html).toContain('2026-08: thu hồi 50.676.806đ (10)');
    expect(html).toContain('3 chứng từ gần nhất');
    expect(html).toContain('Xem chi tiết');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('1K26THA-461');
  });

  it('nhiều tháng thì nói còn bao nhiêu tháng trước', () => {
    const html = renderToStaticMarkup(createElement(CreditNoteDetailDialog, {
      rows: [dong(1)],
      tongThang: [...thang, { thang: '2026-07', tong: 1_000, n: 1, tongDebit: 0, nDebit: 0 }],
    }));
    expect(html).toContain('1 tháng trước');
  });

  it('chưa có chứng từ thì nói rõ và không mời bấm xem', () => {
    const html = renderToStaticMarkup(createElement(CreditNoteDetailDialog, { rows: [], tongThang: [] }));
    expect(html).toContain('Chưa nhập chứng từ nào');
    expect(html).not.toContain('Xem chi tiết');
    expect(html).toContain('disabled');
  });
});
