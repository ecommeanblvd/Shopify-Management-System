import { NHAN_LOAI_NGUOI_NHAN, type LoaiNguoiNhan } from '@/features/kol/types';

/**
 * Tag loại người nhận (KOL / PH) — bản thiết kế 24/09.
 *
 * Loại là thuộc tính của NGƯỜI NHẬN, người dùng không chọn tay, nên tag này chỉ
 * hiển thị chứ không bao giờ là control. Màu lấy qua token nên chạy đúng ở cả
 * nền sáng lẫn tối (thiết kế gốc chỉ vẽ nền tối).
 */
export function TagLoai({ loai }: { loai: LoaiNguoiNhan }) {
  const mau = loai === 'kol'
    ? 'bg-tag-kol-bg text-tag-kol-text'
    : 'bg-tag-ph-bg text-tag-ph-text';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold tracking-[0.04em] ${mau}`}
    >
      {NHAN_LOAI_NGUOI_NHAN[loai]}
    </span>
  );
}
