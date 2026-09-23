import { redirect } from 'next/navigation';

/**
 * "Tạo đơn" nay là một MODAL trên `/f/kol` (spec CEO 23/09/2026 — rebuild),
 * không còn là trang riêng. Giữ route này để link cũ (đã gửi/lưu ở đâu đó —
 * lịch sử chat, bookmark) không 404: điều hướng thẳng về danh sách, nơi nút
 * "+ Tạo đơn" mở modal.
 */
export default function TaoDonKolPage() {
  redirect('/f/kol');
}
