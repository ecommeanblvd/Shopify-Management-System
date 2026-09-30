import { describe, it, expect } from 'vitest';
import { canTuDongLark, COT_CAN_LARK, CAN_TOI_DA_KG } from './can-tu-lark';

const dong = (v: unknown) => ({ [COT_CAN_LARK]: v });

describe('canTuDongLark', () => {
  it('nhận số bình thường — đúng dải đội kho đang điền (0,4–0,7 kg)', () => {
    expect(canTuDongLark(dong(0.7))).toBe(0.7);
    expect(canTuDongLark(dong(0.4))).toBe(0.4);
  });

  it('nhận cả chuỗi — ô Lark từng lưu chuỗi ở dòng cũ', () => {
    expect(canTuDongLark(dong('0.7'))).toBe(0.7);
    expect(canTuDongLark(dong(' 1.25 '))).toBe(1.25);
  });

  it('KHÔNG tự sửa số vô lý, trả null', () => {
    /* Một chiếc áo 500 kg là gõ thừa số 0. Sửa hộ là bịa ra con số không ai cân, và nó trông
       y hệt số thật ở mọi màn phía sau — rồi ra cước sai mà không ai biết vì sao. */
    expect(canTuDongLark(dong(500))).toBeNull();
    expect(canTuDongLark(dong(CAN_TOI_DA_KG + 0.001))).toBeNull();
    expect(canTuDongLark(dong(0))).toBeNull();
    expect(canTuDongLark(dong(-1))).toBeNull();
  });

  it('nhận đúng mốc trần, không loại oan', () => {
    expect(canTuDongLark(dong(CAN_TOI_DA_KG))).toBe(CAN_TOI_DA_KG);
  });

  it('thiếu ô, rỗng, hay rác thì null — không vỡ', () => {
    expect(canTuDongLark(dong(null))).toBeNull();
    expect(canTuDongLark(dong(''))).toBeNull();
    expect(canTuDongLark(dong('nặng lắm'))).toBeNull();
    expect(canTuDongLark(dong([0.5]))).toBeNull();
    expect(canTuDongLark({})).toBeNull();
    expect(canTuDongLark(null)).toBeNull();
  });

  it('KHÔNG đọc nhầm cột "Lineitem weight"', () => {
    // Hai cột đều là số ki-lô trông hợp lý; lấy nhầm thì không ai phát hiện ra.
    expect(canTuDongLark({ 'Lineitem weight': 0.9 })).toBeNull();
    expect(canTuDongLark({ 'Lineitem weight': 0.9, [COT_CAN_LARK]: 0.7 })).toBe(0.7);
  });

  it('giữ 3 số lẻ đúng bằng độ chính xác cột CSDL', () => {
    expect(canTuDongLark(dong(0.1234))).toBe(0.123);
    expect(canTuDongLark(dong(1.9995))).toBe(2);
  });
});
