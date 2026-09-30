'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ghiNhan404 } from '@/features/dieu-huong/ghi-404';

/**
 * Hiện đường dẫn đã gõ sai, và ghi nó vào nhật ký.
 *
 * Phải là client component: `not-found.tsx` KHÔNG nhận props, và tài liệu Next nói rõ muốn biết
 * đường dẫn thì phải đọc ở phía client. Middleware của dự án đặt `x-pathname` lên RESPONSE nên
 * `headers()` phía máy chủ không đọc được nó.
 *
 * Hiện đường dẫn ra cho người dùng THẤY là phần quan trọng nhất: người báo lỗi đọc được ngay
 * mình đang ở đâu, và đọc lại cho người sửa — thứ mà hai vòng hỏi–đáp vừa rồi đã thiếu.
 */
export function Duong404() {
  const duongDan = usePathname();
  // Gửi ĐÚNG MỘT LẦN cho mỗi đường dẫn. Không dùng setState nên không vướng luật React 19
  // cấm đặt state trong thân effect.
  const daGui = useRef<string | null>(null);
  useEffect(() => {
    if (daGui.current === duongDan) return;
    daGui.current = duongDan;
    void ghiNhan404(duongDan);
  }, [duongDan]);

  return (
    <code className="mt-1 block break-all rounded-md border border-border bg-muted px-3 py-2 text-left text-xs">
      {duongDan}
    </code>
  );
}
