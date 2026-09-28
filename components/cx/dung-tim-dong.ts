'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hook gom phần dễ sai nhất của mọi ô tìm: debounce, chặn đua lượt gọi, và TÁCH
 * "lỗi gọi" khỏi "không có kết quả".
 *
 * Gom thành HOOK chứ không component vì phần render khác nhau thật (ô đổi trả hiện
 * số món đã trả, ô ticket hiện chip chọn nhiều) — chỉ phần logic mới đáng gom.
 *
 * Vì sao tách lỗi khỏi rỗng: ngày 24/09 màn nhận hàng bọc lượt gọi trong
 * try/finally KHÔNG có catch, nên một server action chết cũng hiện thành "không có
 * món nào khớp". CEO thử ba lần, không ai biết vì sao. Không bao giờ để một lỗi
 * đội lốt một kết quả rỗng nữa.
 */
export function dungTimDong<T>(tim: (tuKhoa: string) => Promise<T[]>, options?: {
  toiThieu?: number;
  debounceMs?: number;
}) {
  const TOI_THIEU = options?.toiThieu ?? 2;
  const DEBOUNCE_MS = options?.debounceMs ?? 250;

  const [tuKhoa, setTuKhoa] = useState('');
  const [ketQua, setKetQua] = useState<T[]>([]);
  const [dangTim, setDangTim] = useState(false);
  const [loiGoi, setLoiGoi] = useState<string | null>(null);
  const luotRef = useRef(0);
  /** Giữ hàm tìm trong ref: truyền inline `(q) => f(q)` thì tham chiếu đổi mỗi
   *  lượt render, và để nó trong deps của effect là gọi lại vô hạn. */
  const timRef = useRef(tim);
  timRef.current = tim;

  useEffect(() => {
    const ky = tuKhoa.trim();
    if (ky.length < TOI_THIEU) return;
    const luot = ++luotRef.current;
    const t = setTimeout(async () => {
      setDangTim(true);
      try {
        const r = await timRef.current(ky);
        // Lượt cũ về sau lượt mới thì BỎ, không ghi đè kết quả mới hơn.
        if (luot !== luotRef.current) return;
        setKetQua(r);
        setLoiGoi(null);
      } catch (e) {
        if (luot !== luotRef.current) return;
        console.error('[cx] tìm lỗi:', e);
        setKetQua([]);
        setLoiGoi('Không gọi được máy chủ để tìm. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.');
      } finally {
        if (luot === luotRef.current) setDangTim(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [tuKhoa, TOI_THIEU, DEBOUNCE_MS]);

  const ky = tuKhoa.trim();
  /** SUY RA, không lưu: từ khoá ngắn lại thì kết quả cũ không được phép còn hiện. */
  const hienThi = ky.length < TOI_THIEU ? [] : ketQua;

  function doiTuKhoa(v: string) {
    setTuKhoa(v);
    setLoiGoi(null);
  }

  function xoa() {
    // Tăng lượt để mọi lượt gọi đang bay không ghi kết quả vào ô đã xoá.
    luotRef.current += 1;
    setTuKhoa('');
    setKetQua([]);
    setLoiGoi(null);
    setDangTim(false);
  }

  return {
    tuKhoa, ky, doiTuKhoa, xoa,
    hienThi, dangTim, loiGoi,
    duNgan: ky.length < TOI_THIEU,
    toiThieu: TOI_THIEU,
  };
}
