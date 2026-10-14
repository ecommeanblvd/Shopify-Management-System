import { describe, it, expect } from 'vitest';
import { nguonCanDim } from './nguon-can-dim';

const rong = { canKg: null, daiCm: null, rongCm: null, caoCm: null };

describe('nguonCanDim', () => {
  it('có số SMS → dùng số SMS, nguon="sms"', () => {
    const sms = { canKg: '5.5', daiCm: '10', rongCm: '20', caoCm: '30' };
    const lark = { canKg: '9.9', daiCm: '99', rongCm: '99', caoCm: '99' };
    expect(nguonCanDim(sms, lark)).toEqual({
      canKg: 5.5, daiCm: 10, rongCm: 20, caoCm: 30, nguon: 'sms',
    });
  });

  it('không có số SMS → rơi về số Lark, nguon="lark"', () => {
    const lark = { canKg: '9.9', daiCm: '11', rongCm: '22', caoCm: '33' };
    expect(nguonCanDim(rong, lark)).toEqual({
      canKg: 9.9, daiCm: 11, rongCm: 22, caoCm: 33, nguon: 'lark',
    });
  });

  it('SMS có cân nhưng thiếu dim → cân SMS + dim Lark, nguon="sms"', () => {
    const sms = { canKg: '5.5', daiCm: null, rongCm: null, caoCm: null };
    const lark = { canKg: '9.9', daiCm: '11', rongCm: '22', caoCm: '33' };
    expect(nguonCanDim(sms, lark)).toEqual({
      canKg: 5.5, daiCm: 11, rongCm: 22, caoCm: 33, nguon: 'sms',
    });
  });

  it('không bên nào có → nguon=null, mọi ô null', () => {
    expect(nguonCanDim(rong, rong)).toEqual({
      canKg: null, daiCm: null, rongCm: null, caoCm: null, nguon: null,
    });
  });

  it('chuỗi rỗng ở ô SMS coi như chưa gõ, rơi về Lark của đúng ô đó', () => {
    const sms = { canKg: '5.5', daiCm: '', rongCm: null, caoCm: null };
    const lark = { canKg: '9.9', daiCm: '11', rongCm: '22', caoCm: '33' };
    expect(nguonCanDim(sms, lark)).toEqual({
      canKg: 5.5, daiCm: 11, rongCm: 22, caoCm: 33, nguon: 'sms',
    });
  });

  it('số 0 ở ô SMS là một số THẬT đã gõ, không rơi về Lark', () => {
    const sms = { canKg: '5.5', daiCm: '10', rongCm: '20', caoCm: '0' };
    const lark = { canKg: '9.9', daiCm: '11', rongCm: '22', caoCm: '33' };
    expect(nguonCanDim(sms, lark)).toEqual({
      canKg: 5.5, daiCm: 10, rongCm: 20, caoCm: 0, nguon: 'sms',
    });
  });

  it('thiếu cao ở cả hai bên → cao=null, không bị thay bằng 0', () => {
    const sms = { canKg: '5.5', daiCm: '10', rongCm: '20', caoCm: null };
    const lark = { canKg: null, daiCm: null, rongCm: null, caoCm: null };
    expect(nguonCanDim(sms, lark)).toEqual({
      canKg: 5.5, daiCm: 10, rongCm: 20, caoCm: null, nguon: 'sms',
    });
  });
});
