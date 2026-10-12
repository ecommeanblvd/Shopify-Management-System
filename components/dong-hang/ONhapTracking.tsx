'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { luuTrackingChoKien } from '@/features/dong-hang/actions';

/**
 * Ô dán mã vận đơn ngay trên dòng kiện, hiện ra NGAY SAU khi nhân sự quay lại
 * từ hộp thoại "Lên vận đơn" (đã tạo nhãn ở cổng hãng).
 *
 * Nhận cả URL lẫn số trần — bóc số đã có sẵn ở `luuTrackingChoKien`/`macVanDonTu`
 * (có test riêng), nên component này chỉ hứng chuỗi gõ và gửi nguyên văn đi,
 * không tự bóc lại ở đây.
 *
 * Báo kết quả bằng TOAST (`sonner`), KHÔNG tự vẽ kết quả tại chỗ và KHÔNG báo
 * qua state/callback cho cha giữ hộ — review coordinator chỉ ra bản trước đó
 * (nâng state lên `DongKien`) vẫn hỏng: lưu thành công thì `luuTrackingChoKien`
 * `revalidatePath` ngay trong CÙNG lượt gọi, mà các tab mặc định (`cho_chon_line`
 * — tab mở màn chính, xem `queries.ts`) lọc `trackingNumber IS NULL`, nên chính
 * DÒNG KIỆN này rụng khỏi kết quả truy vấn kế tiếp — không chỉ con của nó bị
 * tháo, cả `DongKien` biến mất theo, mang bất cứ state nào nó giữ theo luôn.
 * Toast sống ở cây riêng (`<Toaster/>` cấp layout), không phụ thuộc dòng kiện
 * còn tồn tại hay không nên sống sót qua cú rụng dòng đó.
 */
export function ONhapTracking({ shipmentId }: { shipmentId: string }) {
  const [raw, setRaw] = useState('');
  const [pending, start] = useTransition();

  const luu = () => {
    if (pending || raw.trim() === '') return;
    // Gọi action trong HÀM XỬ LÝ SỰ KIỆN (bấm nút/submit), không trong
    // `useEffect` — dự án bật `react-hooks/set-state-in-effect`, và việc này
    // ghi CSDL + đẩy số lên Lark nên phải xảy ra vì người dùng bấm.
    start(async () => {
      const r = await luuTrackingChoKien(shipmentId, raw);
      if (!r.ok) { toast.error(r.loi, { duration: 10000 }); return; }
      setRaw('');
      // Có cảnh báo = giá chưa ghi được lên Lark — đây là NƠI DUY NHẤT nói
      // điều đó cho nhân sự, nên để sống lâu hơn hẳn toast thường (3s): một
      // toast cảnh báo chớp tắt nhanh cũng là nuốt mất, chỉ chậm hơn im lặng.
      if (r.canhBao) toast.warning(`Đã lưu mã ${r.tracking} — ${r.canhBao}`, { duration: 15000 });
      else toast.success(`Đã lưu mã ${r.tracking}.`, { duration: 3000 });
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
