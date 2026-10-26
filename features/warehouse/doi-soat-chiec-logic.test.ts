import { describe, expect, it } from 'vitest';
import { lyDoKhongSuaChiec, TRAN_SUA_TOI_THIEU } from './doi-soat-chiec-logic';

describe('lyDoKhongSuaChiec — chốt chặn lượt sửa trạng thái CHIẾC', () => {
  /* Lượt này đổi trạng thái hàng loạt trên bảng định danh từng chiếc. Đánh dấu `shipped` làm
   * chiếc biến mất khỏi tầm nhìn allocator vĩnh viễn, và không dựng lại được từ sổ cái —
   * nên cần chốt chặn riêng, cùng họ với D-256 và D-257. */
  it('0 chiếc → từ chối (nghi truy vấn hỏng, không phải đã sạch)', () => {
    expect(lyDoKhongSuaChiec(0, 349)).toMatch(/nghi truy vấn hỏng/);
  });

  it('311/349 trong lượt ĐẦU → cho sửa (trần tối thiểu 400 phủ được tồn đọng)', () => {
    expect(lyDoKhongSuaChiec(311, 349)).toBeNull();
  });

  it('vài chiếc mỗi ngày ở lượt sau → cho sửa', () => {
    expect(lyDoKhongSuaChiec(3, 40)).toBeNull();
  });

  /* Vượt trần = nghi điều kiện chọn sai. Trần là max(400, 60% số đang giữ chỗ), nên với một
   * kho lớn nó co giãn theo, còn kho nhỏ vẫn có sàn 400 để lượt dọn đầu đi qua được. */
  it('vượt trần → từ chối', () => {
    expect(lyDoKhongSuaChiec(TRAN_SUA_TOI_THIEU + 1, 10)).toMatch(/nghi điều kiện chọn sai/);
    expect(lyDoKhongSuaChiec(1000, 1000)).toMatch(/nghi điều kiện chọn sai/);
  });

  it('đúng trần thì vẫn cho (chặn ở VƯỢT, không chặn ở bằng)', () => {
    expect(lyDoKhongSuaChiec(TRAN_SUA_TOI_THIEU, 10)).toBeNull();
    expect(lyDoKhongSuaChiec(600, 1000)).toBeNull();
  });
});
