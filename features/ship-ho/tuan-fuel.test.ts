import { describe, it, expect } from 'vitest';
import { pctTuanCuaNgay, type TuanFuel } from './tuan-fuel';

/* Mức FedEx THẬT quanh tháng 7/2026 — đọc từ `carrier_surcharges` ngày 03/10/2026. */
const TUAN: TuanFuel[] = [
  { tu: '2026-06-29', den: '2026-07-06', pct: 38.5 },
  { tu: '2026-07-06', den: '2026-07-13', pct: 38.25 },
  { tu: '2026-07-13', den: '2026-07-20', pct: 38.5 },
  { tu: '2026-07-20', den: null, pct: 39.75 },
];

describe('pctTuanCuaNgay', () => {
  /* Đúng ca đã gây hiểu nhầm hôm 02/10: ngày tạo nhãn 03/07 ra 38,50%, ngày hãng lấy hàng
     06/07 ra 38,25% — và hoá đơn ghi 38,25%. */
  it('03/07 → 38,50% · 06/07 → 38,25%', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-07-03')).toBe(38.5);
    expect(pctTuanCuaNgay(TUAN, '2026-07-06')).toBe(38.25);
  });

  it('biên: ngày đầu tuần THUỘC tuần đó, ngày cuối thuộc tuần sau', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-07-12')).toBe(38.25);
    expect(pctTuanCuaNgay(TUAN, '2026-07-13')).toBe(38.5);
  });

  it('tuần đang mở (den null) nhận mọi ngày từ mốc đầu trở đi', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-12-31')).toBe(39.75);
  });

  it('ngày trước mọi tuần đã biết → null, KHÔNG đoán', () => {
    expect(pctTuanCuaNgay(TUAN, '2026-01-01')).toBeNull();
  });
});
