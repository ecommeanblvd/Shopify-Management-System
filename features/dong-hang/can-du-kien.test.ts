import { describe, it, expect } from 'vitest';
import { tongCanMon, moTaTongCan, NHAN_DU_KIEN } from './can-du-kien';

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
  it('nói rõ là DỰ KIẾN và vẫn phải cân lại cả kiện', () => {
    /* Cân lúc QC ĐÃ gồm hộp của riêng món đó (CEO: sản phẩm 1 kg mà phải đóng thùng 3 kg thì
       điền 3). Nhiều món gộp một thùng thì tổng này CAO HƠN cân kiện thật — nên nó là số tham
       chiếu, không thay được lần cân thật. Nhãn cũ "chưa gồm thùng" SAI và sai nguy hiểm: nó
       bảo người đóng cộng thêm hộp lần nữa vào con số đã có hộp. */
    const s = moTaTongCan(tongCanMon([{ weightKg: 0.4 }, { weightKg: 0.7 }]));
    expect(s).toContain(NHAN_DU_KIEN);
    expect(s).not.toContain('chưa gồm thùng');
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
