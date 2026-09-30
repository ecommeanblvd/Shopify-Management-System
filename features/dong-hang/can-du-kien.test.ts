import { describe, it, expect } from 'vitest';
import { tongCanMon, moTaTongCan, NHAN_CHUA_GOM_THUNG } from './can-du-kien';

describe('tongCanMon', () => {
  it('cộng đúng, không lệch vì dấu phẩy động', () => {
    // 0.4 + 0.7 trong dấu phẩy động ra 1.1000000000000001, và số đó đi thẳng lên cước.
    expect(tongCanMon([{ weightKg: 0.4 }, { weightKg: 0.7 }]).tongKg).toBe(1.1);
    expect(tongCanMon([{ weightKg: 0.1 }, { weightKg: 0.2 }]).tongKg).toBe(0.3);
  });

  it('THIẾU MỘT MÓN LÀ KHÔNG CỘNG — tổng thiếu vế không tự nói mình sai', () => {
    const r = tongCanMon([{ weightKg: 0.7 }, { weightKg: null }, { weightKg: 0.4 }]);
    expect(r.tongKg).toBeNull();
    expect(r.soMonThieuCan).toBe(1);
    expect(r.soMon).toBe(3);
  });

  it('kiện rỗng thì không có gì để cộng', () => {
    expect(tongCanMon([]).tongKg).toBeNull();
    expect(tongCanMon([]).soMon).toBe(0);
  });

  it('không nhận NaN/Infinity lọt vào tổng', () => {
    expect(tongCanMon([{ weightKg: NaN }]).tongKg).toBeNull();
    expect(tongCanMon([{ weightKg: Infinity }]).tongKg).toBeNull();
  });
});

describe('moTaTongCan — con số này KHÔNG phải cân kiện, câu chữ phải nói ra', () => {
  it('luôn nói "chưa gồm thùng" khi có điền sẵn', () => {
    /* CEO đã nói cân đóng hàng là cân CẢ KIỆN. Điền sẵn tổng cân món mà không nói rõ thì người
       đóng bấm lưu luôn → cân kiện thiếu trọng lượng thùng → cước sai mà không ai biết. */
    const s = moTaTongCan(tongCanMon([{ weightKg: 0.4 }, { weightKg: 0.7 }]));
    expect(s).toContain(NHAN_CHUA_GOM_THUNG);
    expect(s).toContain('1.1');
    expect(s).toContain('2 món');
  });

  it('thiếu cân thì nói THIẾU MẤY MÓN, không nói một con số', () => {
    const s = moTaTongCan(tongCanMon([{ weightKg: 0.7 }, { weightKg: null }]));
    expect(s).toContain('1/2 món');
    expect(s).not.toMatch(/\d+(\.\d+)? kg/);
  });

  it('kiện chưa có món thì nói đúng thế', () => {
    expect(moTaTongCan(tongCanMon([]))).toContain('chưa gắn món');
  });
});
