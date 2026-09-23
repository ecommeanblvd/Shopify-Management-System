'use client';

import { ScanInput } from '@/components/ui/scan-input';

/**
 * Ô quét đứng đầu màn "Nhận & kiểm hàng" (spec §5). Luôn giữ con trỏ: máy quét cầm tay gõ
 * chuỗi rồi Enter y như bàn phím nên không cần bấm nút gì thêm. Trên điện thoại có thêm nút
 * mở camera, dùng `BarcodeDetector` của trình duyệt (Chrome Android có sẵn) — KHÔNG cài thêm
 * thư viện; máy không hỗ trợ thì nút này không hiện, kho gõ tay hoặc dùng máy quét cầm tay.
 *
 * Chỉ còn là LỚP MỎNG bọc `components/ui/scan-input.tsx` (nơi cài đặt duy nhất của hành vi
 * quét — hand-scanner+Enter, camera+`BarcodeDetector`, dọn stream) — rút ra để màn tạo đơn
 * KOL dùng lại ĐÚNG một chỗ thay vì một bản sao có thể trôi lệch dần. Giữ nguyên id, placeholder
 * và mọi className cũ (h-11, không `cursor-pointer`) để HTML render ra giống hệt trước khi
 * tách, và giữ nguyên autoFocus mặc định `true` — hành vi "không cướp focus của ô đang gõ dở"
 * đến từ việc component chỉ `autoFocus` lúc MOUNT (`BangNhanKcs` không remount ô này giữa các
 * lần render), không phải từ bất kỳ logic nào ở đây.
 */
export function OQuet({ onQuet }: { onQuet: (raw: string) => void }) {
  return (
    <ScanInput
      id="o-quet"
      onQuet={onQuet}
      placeholder="Quét mã đơn hoặc tem món…"
      inputClassName="h-11 min-w-[240px] flex-1 rounded-md border border-amber-500/50 bg-input/30 px-3 text-sm outline-none focus:border-amber-500"
      cameraButtonClassName="h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
      stopButtonClassName="h-11 rounded-lg border border-red-500/50 px-4 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
    />
  );
}
