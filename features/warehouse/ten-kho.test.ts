import { describe, it, expect } from 'vitest';
import { TEN_KHO, nhanKho } from './ten-kho';
import { WAREHOUSE_PRIORITY } from './allocation-logic';

describe('nhanKho', () => {
  it('hiện tên kèm mã để vừa dễ đọc vừa khớp bảng biểu', () => {
    expect(nhanKho('GVM')).toBe('Giang Văn Minh (GVM)');
    expect(nhanKho('AP')).toBe('An Phú (AP)');
    expect(nhanKho('DM')).toBe('Diamond Plaza (DM)');
  });

  /* Mã lạ mà bịa tên thì người dùng chọn nhầm kho mà không hay — thà trơ mã. */
  it('mã lạ trả nguyên mã, KHÔNG bịa tên', () => {
    expect(nhanKho('XYZ')).toBe('XYZ');
  });

  /* Thêm kho thứ tư vào hệ thống mà quên đặt tên thì dropdown hiện mã trần;
   * test này bắt ngay lúc đó chứ không để kho tự phát hiện. */
  it('mọi kho hệ thống đang dùng đều có tên', () => {
    for (const ma of WAREHOUSE_PRIORITY) expect(TEN_KHO[ma]).toBeTruthy();
  });
});
