import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { COT_SO_NHAP } from '@/features/kho-nhan/cot-so-nhap';
import type { DongSoNhap } from '@/features/kho-nhan/types';

/* Bảng là client component nên cần router; test chỉ KẾT XUẤT nên một hàm rỗng là đủ. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

const { BangSoNhap } = await import('./BangSoNhap');

const dong = (p: Partial<DongSoNhap>): DongSoNhap => ({
  recordId: 'r1', ngayImport: '2026-10-01', dinhDanh: 'x', warehouse: 'HN | GVM',
  inventoryType: 'Retail', orderNumber: '#MBLVD1', sku: 'SKU-1', lineitemName: 'Áo - Đen / S',
  storeFinal: '#MBLVD', vendorFinal: 'Esmee', qcCheck: 'QC Failed', lyDoFail: 'xước chỉ, bẩn',
  whAction: 'Lưu kho', uniqueCode: 'WH-1', soLuong: 1,
  coAnhHangDen: false, coBbBanGiao: false, anhHangDen: [], bbBanGiao: [],
  anhLoiQc: [{ token: 'tk1', ten: 'loi.jpg' }], cuaHeThong: true, ...p,
});

function ve(ds: DongSoNhap[]): string {
  return renderToStaticMarkup(createElement(BangSoNhap, {
    dong: ds, kho: '', ngay: '2026-10-01', homNay: '2026-10-03',
    cacNgay: ['2026-10-01'], capNhatLuc: new Date('2026-10-01T10:00:00Z'),
  }));
}

/** Các khối mang `grid-template-columns` — hàng tiêu đề và từng dòng dữ liệu. */
function khoiLuoi(html: string): { track: number; oCon: number }[] {
  const ra: { track: number; oCon: number }[] = [];
  const re = /grid-template-columns:([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Đếm ô con trực tiếp: cắt từ sau thẻ mở tới thẻ đóng cân bằng rồi đếm thẻ ở ĐỘ SÂU 1.
    const batDau = html.indexOf('>', m.index) + 1;
    let sau = 0, i = batDau, oCon = 0;
    while (i < html.length) {
      if (html.startsWith('</div>', i) && sau === 0) break;
      const the = /^<(\/?)([a-z]+)[^>]*?(\/?)>/i.exec(html.slice(i));
      if (!the) { i++; continue; }
      const dong2 = the[1] === '/', tuDong = the[3] === '/';
      if (!dong2 && sau === 0) oCon++;
      if (!dong2 && !tuDong) sau++;
      if (dong2) sau--;
      i += the[0].length;
    }
    ra.push({ track: m[1]!.trim().split(/\s+/).length, oCon });
  }
  return ra;
}

describe('BangSoNhap — lưới cột', () => {
  const html = ve([dong({}), dong({ recordId: 'r2', qcCheck: 'QC Pass', lyDoFail: null, anhLoiQc: [] })]);

  /* Hàng tiêu đề và MỌI dòng phải có đúng số ô bằng số đường cột. Thêm cột mà quên thêm ô ở
     dòng là lệch cả bảng về sau, và lệch âm thầm — bảng vẫn vẽ ra bình thường, chỉ sai cột. */
  it('mỗi khối có số ô con bằng số đường cột', () => {
    const k = khoiLuoi(html);
    expect(k.length).toBe(3);                       // 1 tiêu đề + 2 dòng
    for (const x of k) {
      expect(x.track).toBe(COT_SO_NHAP.length);
      expect(x.oCon).toBe(COT_SO_NHAP.length);
    }
  });

  it('tiêu đề có cột lý do lỗi và ảnh lỗi', () => {
    expect(html).toContain('Lý do lỗi');
    expect(html).toContain('Ảnh lỗi');
  });

  /* Bấm vào dòng mở chi tiết. Dòng phải là NÚT THẬT — có `role` và nhãn — chứ không phải div
     chỉ bắt chuột, nếu không người dùng bàn phím không mở được chi tiết nào. */
  it('mỗi dòng là một nút mở chi tiết, đi được bằng bàn phím', () => {
    expect(html.match(/role="button"/g) ?? []).toHaveLength(2);
    expect(html).toContain('aria-label="Xem chi tiết #MBLVD1 SKU-1"');
    expect(html).toContain('tabindex="0"');
  });

  it('dòng trượt QC hiện lý do và ảnh lỗi', () => {
    expect(html).toContain('xước chỉ, bẩn');
    expect(html).toContain('/api/kho-nhan/anh-lark/tk1');
  });
});

describe('cột Ảnh lỗi — chỗ dán ảnh lỗi QC (CEO 03/10/2026)', () => {
  const html = (p: Partial<DongSoNhap>) => ve([dong({ ...p })]);

  /* Đội đóng hàng copy ảnh từ Zalo, không lưu về máy — nên ô phải dán được, như hai cột kia. */
  it('dòng trượt QC chưa có ảnh lỗi → hiện ô tải/dán', () => {
    expect(html({ qcCheck: 'QC Failed', anhLoiQc: [] }))
      .toContain('aria-label="Bổ sung ảnh lỗi qc"');
  });

  /* Gắn ảnh lỗi vào một chiếc ĐẠT là ghi một lỗi không có thật. */
  it('dòng QC Pass thì KHÔNG bày ô tải ảnh lỗi', () => {
    expect(html({ qcCheck: 'QC Pass', anhLoiQc: [] }))
      .not.toContain('aria-label="Bổ sung ảnh lỗi qc"');
  });

  it('dòng đã có ảnh lỗi thì hiện ảnh, không hiện ô tải', () => {
    const h = html({ qcCheck: 'QC Failed', anhLoiQc: [{ token: 'tk1', ten: 'loi.jpg' }] });
    expect(h).toContain('/api/kho-nhan/anh-lark/tk1');
    expect(h).not.toContain('aria-label="Bổ sung ảnh lỗi qc"');
  });
});
