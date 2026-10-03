import { describe, expect, it } from 'vitest';
import { dungDongMirror } from './dong-bo-wh-lark';

const rec = (fields: Record<string, unknown>) => ({ record_id: 'rec1', fields });

/**
 * Hai cột lỗi QC nằm NGOÀI bản sao cho tới 03/10/2026, nên 456 lý do và 429 tấm ảnh của gần ba
 * năm vận hành chỉ có trên Lark (xem migration 0198). Test giữ chúng ở trong.
 */
describe('dungDongMirror — lý do và ảnh lỗi QC', () => {
  it('kéo lý do lỗi về, giữ nguyên chữ người gõ', () => {
    expect(dungDongMirror(rec({ 'Lý do QC failed': 'xước chỉ, bẩn' })).lyDoFail)
      .toBe('xước chỉ, bẩn');
  });

  /* Kho gõ " sai màu" có khoảng trắng đầu (đo thật trên WH-2610-00050). Cắt khoảng trắng là
     cùng cách mọi cột khác của bản sao đang làm — chữ không đổi, chỉ gọn. */
  it('cắt khoảng trắng hai đầu, không đổi chữ', () => {
    expect(dungDongMirror(rec({ 'Lý do QC failed': ' sai màu' })).lyDoFail).toBe('sai màu');
  });

  it('ô trống → null, không phải chuỗi rỗng', () => {
    expect(dungDongMirror(rec({})).lyDoFail).toBeNull();
    expect(dungDongMirror(rec({ 'Lý do QC failed': '   ' })).lyDoFail).toBeNull();
  });

  it('kéo ảnh lỗi về dạng { token, ten }', () => {
    expect(dungDongMirror(rec({
      'Ảnh chụp lỗi QC fail': [{ file_token: 'tk1', name: 'loi.jpg' }],
    })).anhLoiQc).toEqual([{ token: 'tk1', ten: 'loi.jpg' }]);
  });

  it('không có ảnh → mảng rỗng', () => {
    expect(dungDongMirror(rec({})).anhLoiQc).toEqual([]);
  });

  /* Ảnh lỗi KHÔNG được lẫn vào ảnh hàng đến: hai cột khác nhau, hai nghĩa khác nhau — ảnh hàng
     đến là hàng lúc mở kiện, ảnh lỗi là bằng chứng trả vendor. */
  it('không lẫn với ảnh hàng đến', () => {
    const d = dungDongMirror(rec({
      'Ảnh Thực Tế SP': [{ file_token: 'hang', name: 'h.jpg' }],
      'Ảnh chụp lỗi QC fail': [{ file_token: 'loi', name: 'l.jpg' }],
    }));
    expect(d.anhHangDen).toEqual([{ token: 'hang', ten: 'h.jpg' }]);
    expect(d.anhLoiQc).toEqual([{ token: 'loi', ten: 'l.jpg' }]);
  });
});
