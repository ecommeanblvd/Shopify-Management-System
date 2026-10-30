'use client';

import { useState } from 'react';
import { ModalChiTietBaoLoi, type DongBaoLoi, type DongSuKien } from './ModalChiTietBaoLoi';

/**
 * Mở SẴN modal của một báo lỗi — cho `?bl=<số>`, tức link người này gửi người kia.
 *
 * Riêng khỏi `BangLichSuBaoLoi` vì báo lỗi được trỏ tới có thể KHÔNG nằm trong 20 dòng đầu của
 * danh sách; trang tra nó bằng `baoLoiTheoSo` rồi truyền thẳng vào đây.
 */
export function MoSanBaoLoi({ baoLoi, suKien, tenNguoi }: {
  baoLoi: DongBaoLoi;
  suKien: DongSuKien[];
  tenNguoi: Record<string, string>;
}) {
  const [mo, setMo] = useState(true);
  return (
    <ModalChiTietBaoLoi baoLoi={baoLoi} suKien={suKien} tenNguoi={tenNguoi}
      mo={mo} onMoChange={setMo} />
  );
}
