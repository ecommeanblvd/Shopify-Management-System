import { describe, it, expect } from 'vitest';
import { detectInvoiceFormat, toInvoicePreview, fboPreviewFrom, splitByPhase, thongBaoSaiDinhDang, canhBaoUps, nhacFileDungBill } from './invoice-upload';

describe('detectInvoiceFormat', () => {
  it('dhl + .csv → dhl_csv', () => { expect(detectInvoiceFormat('dhl', 'HANR1.csv')).toBe('dhl_csv'); });
  it('fedex + .xlsx/.xls → fbo_xlsx', () => {
    expect(detectInvoiceFormat('fedex', 'FedEx_x.XLSX')).toBe('fbo_xlsx');
    expect(detectInvoiceFormat('fedex', 'a.xls')).toBe('fbo_xlsx');
  });
  it('sai đuôi theo carrier → unsupported', () => {
    expect(detectInvoiceFormat('dhl', 'a.xlsx')).toBe('unsupported');   // DHL chỉ CSV
    expect(detectInvoiceFormat('fedex', 'a.csv')).toBe('unsupported');  // FedEx chỉ XLSX
    expect(detectInvoiceFormat(null, 'a.csv')).toBe('unsupported');
  });
});
describe('detectInvoiceFormat — Aramex (hoá đơn điện tử Việt Nam)', () => {
  it('aramex + .xml → aramex_xml', () => {
    expect(detectInvoiceFormat('aramex', '00007957_1K26TMB.xml')).toBe('aramex_xml');
  });

  // Bảng kê Hợp Nhất đặt đuôi .xls nhưng ruột là xlsx.
  it('aramex + .xls/.xlsx → aramex_xlsx (bảng kê cước)', () => {
    expect(detectInvoiceFormat('aramex', 'BangKeCuocHangXuat.xls')).toBe('aramex_xlsx');
    expect(detectInvoiceFormat('aramex', 'bangke.XLSX')).toBe('aramex_xlsx');
  });

  // PDF vẫn nhận diện được để báo cho người dùng biết là không cần tải,
  // thay vì im lặng coi như file lạ.
  it('aramex + .pdf → aramex_pdf, KHÔNG rơi vào nhánh invoice_pdf', () => {
    expect(detectInvoiceFormat('aramex', '00007957_1K26TMB.pdf')).toBe('aramex_pdf');
  });

  it('đuôi khác thì không nhận', () => {
    expect(detectInvoiceFormat('aramex', 'a.csv')).toBe('unsupported');
    expect(detectInvoiceFormat('aramex', 'a.docx')).toBe('unsupported');
  });

  it('bảng kê và hoá đơn cùng vào nhóm xử lý chính', () => {
    const r = splitByPhase([{ filename: 'bk.xls' }, { filename: 'hd.xml' }], 'aramex');
    expect(r.spreadsheets.map((f) => f.filename).sort()).toEqual(['bk.xls', 'hd.xml']);
    expect(r.unsupported).toEqual([]);
  });
});

describe('toInvoicePreview', () => {
  it('chuẩn hoá DHL; warning khi currency lệch account', () => {
    const pv = toInvoicePreview({ kind: 'dhl', accountCurrency: 'VND', p: {
      billNumber: 'HANR1', amountInclVat: 1000, periodStart: '2026-01-01', periodEnd: '2026-01-05',
      issueDate: '2026-01-06', dueDate: '2026-02-05', currency: 'USD', shipments: [{}, {}] } });
    expect(pv).toMatchObject({ carrier: 'dhl', billNumber: 'HANR1', amount: 1000, lineCount: 2, dueDate: '2026-02-05' });
    expect(pv.warnings.some((w) => /currency|VND|USD/i.test(w))).toBe(true);
  });
  it('chuẩn hoá FBO (FedEx); issue/due = null (FboBillSummary không có)', () => {
    const pv = toInvoicePreview({ kind: 'fbo', accountCurrency: 'VND', b: {
      billNumber: 'FB9', periodStart: '2026-01-01', periodEnd: '2026-01-09', amount: 50000, lineCount: 7 } });
    expect(pv).toMatchObject({ carrier: 'fedex', billNumber: 'FB9', amount: 50000, lineCount: 7, currency: 'VND', warnings: [] });
    expect(pv.issueDate).toBeNull(); expect(pv.dueDate).toBeNull();
  });
});
describe('fboPreviewFrom', () => {
  it('1 bill → delegates to toInvoicePreview (billNumber set, no warning)', () => {
    const pv = fboPreviewFrom(
      [{ billNumber: 'FB1', periodStart: '2026-01-01', periodEnd: '2026-01-31', amount: 10000, lineCount: 5 }],
      'VND',
    );
    expect(pv).toMatchObject({ carrier: 'fedex', billNumber: 'FB1', amount: 10000, lineCount: 5, currency: 'VND' });
    expect(pv.warnings).toHaveLength(0);
  });
  it('2 bills → billNumber null, amount = sum, periodStart = earliest, periodEnd = latest, lineCount = sum, exactly one warning mentioning "2 hoá đơn"', () => {
    const pv = fboPreviewFrom(
      [
        { billNumber: 'FB1', periodStart: '2026-01-01', periodEnd: '2026-01-15', amount: 10000, lineCount: 3 },
        { billNumber: 'FB2', periodStart: '2026-01-10', periodEnd: '2026-01-31', amount: 20000, lineCount: 7 },
      ],
      'VND',
    );
    expect(pv.billNumber).toBeNull();
    expect(pv.amount).toBe(30000);
    expect(pv.periodStart).toBe('2026-01-01');
    expect(pv.periodEnd).toBe('2026-01-31');
    expect(pv.lineCount).toBe(10);
    expect(pv.warnings).toHaveLength(1);
    expect(pv.warnings[0]).toMatch(/2 hoá đơn/);
  });
});

describe('detectInvoiceFormat — PDF', () => {
  it('.pdf (mọi carrier) → invoice_pdf', () => {
    expect(detectInvoiceFormat('fedex', 'PART_1.PDF')).toBe('invoice_pdf');
    expect(detectInvoiceFormat('dhl', 'hoadon.pdf')).toBe('invoice_pdf');
    expect(detectInvoiceFormat(null, 'x.pdf')).toBe('invoice_pdf');
  });
});

describe('InvoicePreview.format', () => {
  it('DHL preview gắn format dhl_csv', () => {
    const pv = toInvoicePreview({ kind: 'dhl', accountCurrency: 'VND', p: {
      billNumber: 'HANR1', amountInclVat: 1000, periodStart: '2026-01-01', periodEnd: '2026-01-05',
      issueDate: '2026-01-06', dueDate: '2026-02-05', currency: 'VND', shipments: [{}] } });
    expect(pv.format).toBe('dhl_csv');
  });
  it('FBO preview gắn format fbo_xlsx', () => {
    const pv = fboPreviewFrom([{ billNumber: 'FB9', periodStart: null, periodEnd: null, amount: 1, lineCount: 1 }], 'VND');
    expect(pv.format).toBe('fbo_xlsx');
  });
});

describe('splitByPhase', () => {
  const f = (filename: string) => ({ filename });
  it('tách spreadsheet / pdf / unsupported theo carrier', () => {
    const r = splitByPhase([f('a.csv'), f('b.pdf'), f('c.xlsx'), f('d.txt')], 'dhl');
    expect(r.spreadsheets.map((x) => x.filename)).toEqual(['a.csv']);   // dhl: chỉ .csv là spreadsheet
    expect(r.pdfs.map((x) => x.filename)).toEqual(['b.pdf']);
    expect(r.unsupported.map((x) => x.filename)).toEqual(['c.xlsx', 'd.txt']); // .xlsx không hợp lệ cho dhl
  });
  it('fedex: .xlsx là spreadsheet, .csv unsupported', () => {
    const r = splitByPhase([f('a.csv'), f('b.xlsx'), f('c.pdf')], 'fedex');
    expect(r.spreadsheets.map((x) => x.filename)).toEqual(['b.xlsx']);
    expect(r.pdfs.map((x) => x.filename)).toEqual(['c.pdf']);
    expect(r.unsupported.map((x) => x.filename)).toEqual(['a.csv']);
  });
});

describe('thongBaoSaiDinhDang', () => {
  it('nêu đúng định dạng của hãng đang mở', () => {
    expect(thongBaoSaiDinhDang('fedex')).toMatch(/FedEx/);
    expect(thongBaoSaiDinhDang('dhl')).toMatch(/DHL/);
    expect(thongBaoSaiDinhDang('aramex')).toMatch(/Aramex/);
  });

  // Trước đây mọi hãng chưa hỗ trợ đều nhận câu "sai định dạng DHL" — tải file
  // FedEx nhầm tài khoản thì được bảo là sai định dạng DHL, không hiểu vì sao.
  it('hãng chưa hỗ trợ thì nói rõ là chưa hỗ trợ, không đổ cho DHL', () => {
    // Ví dụ cũ ở đây là 'ups' — UPS đã hỗ trợ từ 12/10/2026 nên đổi sang hãng chưa có
    // đường nhập hoá đơn (tài khoản SF Express đã tồn tại trong hệ thống).
    const m = thongBaoSaiDinhDang('sf-express');
    expect(m).toMatch(/chưa hỗ trợ/i);
    expect(m).toMatch(/sf-express/);
    expect(m).not.toMatch(/định dạng hoá đơn DHL/);
  });

  it('nhắc kiểm tra đang mở đúng tài khoản carrier', () => {
    expect(thongBaoSaiDinhDang('sf-express')).toMatch(/đúng tài khoản/i);
  });
});

describe('detectInvoiceFormat — UPS', () => {
  it('ups + .xml → ups_xml (Billing Data XML, dạng máy đọc duy nhất UPS phát hành)', () => {
    expect(detectInvoiceFormat('ups', 'Invoice_100000813108_100626.xml')).toBe('ups_xml');
    expect(detectInvoiceFormat('ups', 'a.XML')).toBe('ups_xml');
  });
  it('PDF của UPS chỉ để đính chứng từ, không dựng bill', () => {
    expect(detectInvoiceFormat('ups', 'UPS bill T9.pdf')).toBe('invoice_pdf');
  });
  it('ups_xml đi vào PHA spreadsheet — bill phải tồn tại trước khi đính PDF', () => {
    const r = splitByPhase([{ filename: 'a.xml' }, { filename: 'b.pdf' }], 'ups');
    expect(r.spreadsheets.map((f) => f.filename)).toEqual(['a.xml']);
    expect(r.pdfs.map((f) => f.filename)).toEqual(['b.pdf']);
  });
  it('câu báo sai định dạng nói đúng file UPS cần tải', () => {
    expect(thongBaoSaiDinhDang('ups')).toContain('Billing Data XML');
  });
});

describe('canhBaoUps', () => {
  it('chênh đúng bằng TaxVarianceAmount → nói rõ là KHỚP, không để người đọc tưởng rơi tiền', () => {
    const w = canhBaoUps({ amount: 69_119_131, taxVariance: 7_746, rows: [{ total: 69_111_385 }], maLa: [] });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('đúng số hoá đơn');
  });
  it('chênh KHÁC chênh thuế → bắt kiểm lại trước khi lưu', () => {
    const w = canhBaoUps({ amount: 100_000, taxVariance: 0, rows: [{ total: 90_000 }], maLa: [] });
    expect(w[0]).toContain('kiểm lại');
  });
  it('Σ dòng khớp số hoá đơn và không mã lạ → không cảnh báo gì', () => {
    expect(canhBaoUps({ amount: 100, taxVariance: 0, rows: [{ total: 100 }], maLa: [] })).toEqual([]);
  });
  it('mã phí lạ được nêu tên', () => {
    const w = canhBaoUps({ amount: 100, taxVariance: 0, rows: [{ total: 100 }], maLa: ['ACC/ZZZ'] });
    expect(w[0]).toContain('ACC/ZZZ');
  });
});

describe('nhacFileDungBill — tải PDF trước thì nhắc đúng file dựng bill', () => {
  it('UPS nhắc Billing Data XML, KHÔNG nhắc CSV/XLSX (hai thứ UPS không phát hành)', () => {
    const m = nhacFileDungBill('ups');
    expect(m).toContain('XML');
    expect(m).not.toMatch(/CSV|XLSX/);
  });
  it('mỗi hãng nhắc đúng file của hãng đó', () => {
    expect(nhacFileDungBill('dhl')).toMatch(/CSV/);
    expect(nhacFileDungBill('fedex')).toMatch(/XLSX/);
  });
  it('hãng lạ thì nói chung, không bịa tên file', () => {
    expect(nhacFileDungBill(null)).not.toMatch(/CSV|XLSX|XML/);
  });
});
