import { NHAN_LOAI_NGUOI_NHAN, type LoaiNguoiNhan } from '@/features/kol/types';

/**
 * Tag loại người nhận (KOL / PH) — bản thiết kế 24/09.
 *
 * Loại là thuộc tính của NGƯỜI NHẬN, người dùng không chọn tay, nên tag này chỉ
 * hiển thị chứ không bao giờ là control. Màu lấy qua token nên chạy đúng ở cả
 * nền sáng lẫn tối (thiết kế gốc chỉ vẽ nền tối).
 */
export function TagLoai({ loai }: { loai: LoaiNguoiNhan }) {
  // Dùng thẳng thang màu Tailwind như phần còn lại của repo (amber/emerald/red
  // đều đang dùng kiểu `600` + `dark:400`), KHÔNG tự đẻ token riêng: token bespoke
  // dễ trùng tên với lớp bắc cầu của shadcn rồi hỏng trong im lặng — đúng thứ vừa
  // làm `text-muted` thành chữ đen trên nền đen. Hue bám bản thiết kế: KOL hồng,
  // Production House xanh ngọc.
  const mau = loai === 'kol'
    ? 'bg-pink-500/15 text-pink-700 dark:bg-pink-500/25 dark:text-pink-300'
    : 'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-500/25 dark:text-cyan-300';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold tracking-[0.04em] ${mau}`}
    >
      {NHAN_LOAI_NGUOI_NHAN[loai]}
    </span>
  );
}
