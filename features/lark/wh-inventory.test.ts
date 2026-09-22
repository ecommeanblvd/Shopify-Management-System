import { describe, it, expect } from 'vitest';
import { locDongTheoMon, docDongKho, locCotChon } from './wh-inventory';

const rec = (id: string, monIds: string[]) => ({
  record_id: id,
  fields: { 'Import (select order)': { link_record_ids: monIds } },
});

describe('locDongTheoMon', () => {
  it('chọn ĐÚNG dòng nối tới món này, không lấy nhầm dòng khác của cùng đơn', () => {
    const recs = [rec('recA', ['recMON1']), rec('recB', ['recMON2'])];
    expect(locDongTheoMon(recs, 'recMON2')).toBe('recB');
  });
  it('chưa có dòng nào của món → null (sẽ tạo mới)', () => {
    expect(locDongTheoMon([rec('recA', ['recMON1'])], 'recMONX')).toBeNull();
  });
  it('dòng không có link thì bỏ qua, không nổ', () => {
    expect(locDongTheoMon([{ record_id: 'recC', fields: {} }], 'recMON1')).toBeNull();
  });
  it('nhiều dòng cùng món → lấy dòng ĐẦU, để không tạo thêm bản sao', () => {
    const recs = [rec('recA', ['recMON1']), rec('recB', ['recMON1'])];
    expect(locDongTheoMon(recs, 'recMON1')).toBe('recA');
  });
});

describe('docDongKho', () => {
  it('đọc kết quả kho đang có trên dòng Lark (ô số, ô chữ, ô rich-text)', () => {
    const r = {
      record_id: 'recWH',
      fields: {
        'Quantity tiếp nhận trước QC': 2,
        'Weight (kg)': '1.4',
        'QC Check': 'QC Failed',
        'WH - Action': 'Gửi trả Vendor (QC fail)',
        'Lý do QC failed': [{ text: 'bung chỉ' }],
      },
    };
    expect(docDongKho(r)).toEqual({
      recordId: 'recWH', soLuong: 2, canKg: 1.4, qcCheck: 'QC Failed',
      whAction: 'Gửi trả Vendor (QC fail)', lyDoFail: 'bung chỉ',
    });
  });

  it('dòng rỗng → mọi ô null, không nổ và không đoán bừa', () => {
    expect(docDongKho({ record_id: 'recX', fields: {} })).toEqual({
      recordId: 'recX', soLuong: null, canKg: null, qcCheck: null, whAction: null, lyDoFail: null,
    });
  });
});

describe('locCotChon', () => {
  const hopLe = new Map([
    ['Store final', new Set(['#MBLVD'])],
    ['Vendor final', new Set(['TRACY STUDIO'])],
  ]);

  it('giá trị có trong danh sách chọn của Lark → giữ nguyên', () => {
    const { cot, boQua } = locCotChon({ 'Store final': '#MBLVD', 'Vendor final': 'TRACY STUDIO', 'QC Check': 'QC Pass' }, hopLe);
    expect(cot).toEqual({ 'Store final': '#MBLVD', 'Vendor final': 'TRACY STUDIO', 'QC Check': 'QC Pass' });
    expect(boQua).toEqual([]);
  });

  it('giá trị LẠ → bỏ cột đó, báo lại để ghi log, không đẻ lựa chọn mới trên Lark', () => {
    const { cot, boQua } = locCotChon({ 'Store final': '#MBLVD', 'Vendor final': 'tracy studio' }, hopLe);
    expect('Vendor final' in cot).toBe(false);
    expect(cot['Store final']).toBe('#MBLVD');
    expect(boQua).toEqual([{ cot: 'Vendor final', giaTri: 'tracy studio' }]);
  });

  it('không đọc được danh sách chọn → bỏ cả hai cột, thà thiếu còn hơn làm hỏng bộ lọc', () => {
    const { cot, boQua } = locCotChon({ 'Store final': '#MBLVD', 'Vendor final': 'TRACY STUDIO' }, new Map());
    expect(cot).toEqual({});
    expect(boQua.map((b) => b.cot)).toEqual(['Store final', 'Vendor final']);
  });

  it('không có cột chọn nào trong bộ cột → giữ nguyên, không thêm khoá rỗng', () => {
    const { cot, boQua } = locCotChon({ 'QC Check': 'QC Pass' }, hopLe);
    expect(cot).toEqual({ 'QC Check': 'QC Pass' });
    expect(boQua).toEqual([]);
  });
});
