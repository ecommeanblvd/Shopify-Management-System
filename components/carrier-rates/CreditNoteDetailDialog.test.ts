import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditNoteDetailDialog, OKienLienQuan } from './CreditNoteDetailDialog';

const dong = (i: number) => ({
  id: String(i), soHoaDon: String(460 + i), kyHieu: '1K26THA', ngay: '2026-08-27',
  tongCong: 3_453_840, tenFile: `${1460 + i}.xml`, loai: 'credit' as const,
  kien: [], maLa: [], vuongMac: 'Chứng từ chỉ ghi mã tham chiếu của hãng, không ghi mã vận đơn',
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

describe('cột Kiện liên quan (CEO 30/09/2026)', () => {
  /* Cột này trước nay đếm `credit_note_lines` — bảng RỖNG nên hiện "—" cho mọi dòng và sẽ hiện
     "—" mãi mãi. Nay nối bằng mã vận đơn bóc từ nội dung chứng từ. */
  const mo = (r: Parameters<typeof CreditNoteDetailDialog>[0]['rows']) =>
    renderToStaticMarkup(createElement('table', null, createElement('tbody', null,
      createElement('tr', null, createElement(OKienLienQuan, { r: r[0] })))));

  it('nối được thì hiện MÃ VẬN ĐƠN và mã đơn, không phải một con số đếm', () => {
    const html = mo([{ ...dong(1), kien: [{ tracking: '876291039886', maDon: '#MBLVD29877', nguon: 'shopify' as const }], vuongMac: null }]);
    expect(html).toContain('876291039886');
    expect(html).toContain('#MBLVD29877');
  });

  it('không nối được thì nói VÌ SAO, không để trống — DHL không ghi mã vận đơn', () => {
    const html = mo([dong(1)]);
    expect(html).toContain('chỉ ghi mã tham chiếu của hãng');
  });

  it('mã bóc được mà không có kiện nào mang mã đó thì cảnh báo riêng', () => {
    const html = mo([{ ...dong(1), maLa: ['875849572911'] }]);
    expect(html).toContain('875849572911');
    expect(html).toContain('không có trong hệ thống');
  });

  it('đơn ship hộ được đánh dấu để không nhầm với kiện của store', () => {
    const html = mo([{ ...dong(1), kien: [{ tracking: '111', maDon: '26-INSLG-SV-0046', nguon: 'ship_ho' as const }], vuongMac: null }]);
    expect(html).toContain('ship hộ');
  });
});
