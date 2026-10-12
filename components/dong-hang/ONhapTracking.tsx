'use client';

import { useState, useTransition } from 'react';
import { luuTrackingChoKien, type KetQuaLuuTracking } from '@/features/dong-hang/actions';

/**
 * Ô dán mã vận đơn ngay trên dòng kiện, hiện ra NGAY SAU khi nhân sự quay lại
 * từ hộp thoại "Lên vận đơn" (đã tạo nhãn ở cổng hãng).
 *
 * Nhận cả URL lẫn số trần — bóc số đã có sẵn ở `luuTrackingChoKien`/`macVanDonTu`
 * (có test riêng), nên component này chỉ hứng chuỗi gõ và gửi nguyên văn đi,
 * không tự bóc lại ở đây.
 *
 * KHÔNG tự hiển thị kết quả: trả nguyên kết quả ra qua `onKetQua` để cha
 * (`DongKien` trong BangDongHang.tsx) giữ hộ. Lý do: lưu thành công thì action
 * `revalidatePath` ngay trong CÙNG lượt gọi này — props `k.trackingNumber` của
 * cha có thể đổi và gỡ `canhBao` nếu hàm con này cố tự giữ kết quả, state sẽ bị
 * tháo cây cùng lúc. Cha không bị tháo theo props đó nên giữ được hộ.
 */
export function ONhapTracking({
  shipmentId, onKetQua,
}: {
  shipmentId: string;
  onKetQua: (ketQua: KetQuaLuuTracking) => void;
}) {
  const [raw, setRaw] = useState('');
  const [pending, start] = useTransition();

  const luu = () => {
    if (pending || raw.trim() === '') return;
    // Gọi action trong HÀM XỬ LÝ SỰ KIỆN (bấm nút/submit), không trong
    // `useEffect` — dự án bật `react-hooks/set-state-in-effect`, và việc này
    // ghi CSDL + đẩy số lên Lark nên phải xảy ra vì người dùng bấm.
    start(async () => {
      const r = await luuTrackingChoKien(shipmentId, raw);
      onKetQua(r);
      if (r.ok) setRaw('');
    });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); luu(); }}
      className="flex items-center gap-1.5"
    >
      <input
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        disabled={pending}
        placeholder="Dán mã hoặc link vận đơn"
        aria-label="Mã vận đơn"
        className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-[12px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={pending || raw.trim() === ''}
        className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium transition hover:border-foreground/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Đang lưu…' : 'Lưu'}
      </button>
    </form>
  );
}
