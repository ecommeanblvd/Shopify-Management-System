import { describe, it, expect } from 'vitest';
import { doiChieu, coLech } from './doi-chieu-logic';

const c = (unitCode: string, larkRecordId: string | null) =>
  ({ unitCode, maDon: '#MBLVD1', sku: 'SKU-1', larkRecordId });
const l = (recordId: string) => ({ recordId, maDon: '#MBLVD1', sku: 'SKU-1' });

describe('doiChieu', () => {
  it('hai bên khớp hết → không lệch gì', () => {
    const k = doiChieu([c('WH-1', 'rec1'), c('WH-2', 'rec2')], [l('rec1'), l('rec2')]);
    expect(k.khop).toBe(2);
    expect(coLech(k)).toBe(false);
  });

  it('chiếc chưa gửi vào nhóm chuaGui, KHÔNG tính là khớp', () => {
    const k = doiChieu([c('WH-1', null)], []);
    expect(k.chuaGui.map((x) => x.unitCode)).toEqual(['WH-1']);
    expect(k.khop).toBe(0);
  });

  /* Loại lệch ÂM THẦM nhất: bên mình tưởng đã gửi, Lark thì không còn dòng nào.
   * Không thao tác nào báo lỗi, chỉ đối chiếu mới lòi ra. */
  it('có lark_record_id mà Lark không còn → matTrenLark', () => {
    const k = doiChieu([c('WH-1', 'recDaXoa')], [l('recKhac')]);
    expect(k.matTrenLark.map((x) => x.unitCode)).toEqual(['WH-1']);
    expect(k.chiCoTrenLark.map((x) => x.recordId)).toEqual(['recKhac']);
  });

  it('dòng Lark mình không có → chiCoTrenLark', () => {
    const k = doiChieu([], [l('recA'), l('recB')]);
    expect(k.chiCoTrenLark).toHaveLength(2);
  });

  /* Dòng Lark đã ghép với một chiếc thì KHÔNG được đếm lại là "chỉ có trên
   * Lark" — nếu không, mọi lượt đối chiếu khớp hoàn toàn vẫn báo lệch. */
  it('dòng Lark đã ghép không bị đếm thành thừa', () => {
    const k = doiChieu([c('WH-1', 'rec1')], [l('rec1')]);
    expect(k.chiCoTrenLark).toHaveLength(0);
  });

  /* Hai chiếc cùng trỏ vào MỘT record Lark là dữ liệu hỏng; phép đếm không
   * được im lặng nuốt cái thứ hai. */
  it('hai chiếc trỏ cùng một record vẫn đếm khớp cả hai, không nuốt', () => {
    const k = doiChieu([c('WH-1', 'rec1'), c('WH-2', 'rec1')], [l('rec1')]);
    expect(k.khop).toBe(2);
    expect(k.chiCoTrenLark).toHaveLength(0);
  });
});
