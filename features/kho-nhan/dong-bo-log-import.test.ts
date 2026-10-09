import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dungDongLogImport } from './dong-bo-log-import';

/* Hình dạng thật, chép từ lượt dò bảng `LOG - Import` ngày 08/10/2026. Ba cột cần đọc đều là
   cột LOOKUP nên Lark bọc thêm một lớp `{ type, value }` — đúng hình dạng mà ba bản đọc cục bộ
   cũ trong repo đều trả về rỗng. */
const REC = {
  record_id: 'recvq3XyakVcS7',
  fields: {
    'Order number': { type: 1, value: [{ text: '#MBLVD29442', type: 'text' }] },
    SKU: { type: 1, value: [{ text: 'KAL-25T1C2-PURPLE-M', type: 'text' }] },
    'Request ID': [{ text: 'RF9889AD46\n', type: 'text' }],
    'Return Status': 'Approved',
    'LOG-IP-Return Status': 'Warehouse Received',
    'LOG-IP-Return Category': 'KP - Returned',
    Quantity: 1,
    'WH - Tiếp nhận & QC': { type: 3, value: ['QC Pass'] },
  },
};

describe('dungDongLogImport', () => {
  it('đọc được cả ba cột LOOKUP', () => {
    const d = dungDongLogImport(REC);
    expect(d.orderNumber).toBe('#MBLVD29442');
    expect(d.sku).toBe('KAL-25T1C2-PURPLE-M');
    expect(d.whTiepNhanQc).toBe('QC Pass');
  });

  /* Bốn cột lookup `WH -` trên chính bảng đó khớp dòng WH - Inventory theo ĐÚNG chuỗi này. Strip
     `#` ở đây là tự tạo lệch với bảng vận hành. */
  it('GIỮ NGUYÊN dấu `#` của mã đơn', () => {
    expect(dungDongLogImport(REC).orderNumber).toMatch(/^#/);
  });

  it('cột chọn đọc nguyên văn, dùng làm cửa nhận', () => {
    const d = dungDongLogImport(REC);
    expect(d.logStatus).toBe('Warehouse Received');
    expect(d.returnStatus).toBe('Approved');
    expect(d.returnCategory).toBe('KP - Returned');
  });

  it('cắt khoảng trắng và xuống dòng trong ô text', () => {
    expect(dungDongLogImport(REC).requestId).toBe('RF9889AD46');
  });

  /* Số lượng thiếu/0 coi là 1: bảng thật mỗi dòng một món trả về, và 0 làm dòng trông như đã
     nhận đủ rồi — món thật sẽ không bao giờ hiện ra ở ô tìm. */
  it('số lượng thiếu hoặc ≤ 0 → coi là 1', () => {
    expect(dungDongLogImport({ record_id: 'r', fields: {} }).soLuong).toBe(1);
    expect(dungDongLogImport({ record_id: 'r', fields: { Quantity: 0 } }).soLuong).toBe(1);
    expect(dungDongLogImport({ record_id: 'r', fields: { Quantity: 3 } }).soLuong).toBe(3);
  });

  it('ô trống → null, không phải chuỗi rỗng', () => {
    const d = dungDongLogImport({ record_id: 'r', fields: {} });
    expect(d.orderNumber).toBeNull();
    expect(d.sku).toBeNull();
    expect(d.whTiepNhanQc).toBeNull();
    expect(d.logStatus).toBeNull();
  });

  it('dựng chữ tìm không dấu từ mã đơn + SKU', () => {
    expect(dungDongLogImport(REC).timKiem).toBe('#mblvd29442 kal-25t1c2-purple-m');
  });
});

/* Bộ đếm `choNhan` phải nói ĐÚNG số ô tìm hiện. Bản đầu chỉ xét trạng thái + cột lookup nên báo
   42 trong khi ô tìm hiện 25 — thiếu điều kiện "phải có mã đơn và SKU", mà bảng thật có 205/666
   dòng trống một trong hai. Bài test canh việc bộ đếm gọi lại đúng hàm luật. */
describe('dongBoLogImport — bộ đếm choNhan', () => {
  it('gọi lại `returnConNhanDuoc`, không chép điều kiện', async () => {
    const src = await readFile(new URL('./dong-bo-log-import.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/returnConNhanDuoc\(/);
    // Chép lại tên trạng thái vào đây là hai bản của một luật.
    expect(src).not.toMatch(/'Warehouse Received'|'Return-Processing'|'Pakago Received'/);
  });
});

/* Dòng ĐÚNG CỬA mà thiếu khoá phải đếm RIÊNG, không gộp vào "không nhận được" — nếu không thì
   nó biến mất lặng lẽ. Đo 09/10/2026 con số này là 0; nó khác 0 mới là lúc cần dựng đường cứu
   từ cột `(From CX File)`. */
describe('dongBoLogImport — đếm riêng dòng ở cửa mà thiếu khoá', () => {
  it('có đếm `thieuKhoa`, dùng chính danh sách trạng thái của luật', async () => {
    const src = await readFile(new URL('./dong-bo-log-import.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/thieuKhoa/);
    expect(src).toMatch(/TRANG_THAI_CHO_NHAN\.has/);
    // Không chép tên trạng thái ra đây — hai bản của một luật.
    expect(src).not.toMatch(/'Return-Processing'|'Pakago Received'|'Warehouse Received'/);
  });
});
