import { describe, expect, it } from 'vitest';
import { docSoDoMayDo, laMayDo } from './so-do-may-do';

/** Thuộc tính THẬT của đơn "Rosaline Off-Shoulder Applique Maxi Dress" (CEO gửi 28/09/2026),
 *  giữ nguyên thứ tự Shopify trả về — cố ý lộn xộn. */
const THAT = [
  { key: '_Customize Type', value: 'Collar Dresses' },
  { key: '1--1.Bust*', value: '75 cm' },
  { key: '1--2.Waist*', value: '63 cm' },
  { key: '2--3.Hip*', value: '85 cm' },
  { key: '2--4.Shoulder*', value: '39 cm' },
  { key: '3--5.Biceps/Upper Arms*', value: '25 cm' },
  { key: '4--7.Bust Height*', value: '25 cm' },
  { key: '4--8.Front Waist Drop*', value: '38 cm' },
  { key: '6--10.Your Height*', value: '155 cm' },
  { key: '6--11.Your Weight*', value: '49 kg' },
  { key: '3--6.Arm Hole', value: '36 cm' },
  { key: '5--9.Neck Size', value: '' },
  { key: '7--13.1.Dress Length - Measure from the collar stand', value: '135 cm' },
  { key: 'Estimated Delivery', value: '26 October - 4 November' },
];

describe('docSoDoMayDo', () => {
  it('đọc được loại rập từ khoá ẩn "_Customize Type"', () => {
    expect(docSoDoMayDo(THAT).loai).toBe('Collar Dresses');
  });

  it('XẾP LẠI theo số thứ tự — Shopify trả lộn xộn, KCS đo theo thứ tự rập', () => {
    expect(docSoDoMayDo(THAT).soDo.map((s) => s.thuTu))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13.1]);
  });

  it('bóc đúng tên và cờ bắt buộc, bỏ dấu * khỏi tên hiển thị', () => {
    const s = docSoDoMayDo(THAT).soDo;
    expect(s[0]).toMatchObject({ ten: 'Bust', batBuoc: true, giaTri: '75 cm', nhom: 1 });
    expect(s.find((x) => x.thuTu === 6)).toMatchObject({ ten: 'Arm Hole', batBuoc: false, giaTri: '36 cm' });
  });

  it('số thứ tự có phần thập phân (13.1) vẫn xếp đúng cuối', () => {
    const cuoi = docSoDoMayDo(THAT).soDo.at(-1)!;
    expect(cuoi.thuTu).toBe(13.1);
    expect(cuoi.ten).toBe('Dress Length - Measure from the collar stand');
  });

  it('ô khách BỎ TRỐNG vẫn xuất hiện với giá trị null — không được ẩn đi', () => {
    const neck = docSoDoMayDo(THAT).soDo.find((x) => x.ten === 'Neck Size');
    expect(neck).toBeDefined();
    expect(neck!.giaTri).toBeNull();
    expect(docSoDoMayDo(THAT).soTrong).toBe(1);
  });

  it('"Estimated Delivery" tách riêng, KHÔNG lẫn vào số đo', () => {
    const r = docSoDoMayDo(THAT);
    expect(r.giaoDuKien).toBe('26 October - 4 November');
    expect(r.soDo.some((s) => /delivery/i.test(s.ten))).toBe(false);
  });

  it('đơn thường (không thuộc tính) → không phải may đo', () => {
    expect(laMayDo(docSoDoMayDo([]))).toBe(false);
    expect(laMayDo(docSoDoMayDo(null))).toBe(false);
    expect(docSoDoMayDo(null)).toMatchObject({ loai: null, soDo: [], giaoDuKien: null, soTrong: 0 });
  });

  it('có ít nhất một số đo → là may đo', () => {
    expect(laMayDo(docSoDoMayDo(THAT))).toBe(true);
  });

  it('khoá lạ không đúng dạng số đo thì bỏ qua, không bịa dòng', () => {
    expect(docSoDoMayDo([{ key: 'Gift message', value: 'Happy birthday' }]).soDo).toEqual([]);
  });
});
