'use client';

import { useRouter } from 'next/navigation';
import { dongDuocXuLy } from '@/lib/ui/su-kien-trong-dong';

/**
 * Row bảng đơn ship hộ: click BẤT KỲ chỗ nào trên row → mở chi tiết đơn
 * (không chỉ link ở cột Mã). Hỗ trợ bàn phím (Enter/Space).
 *
 * `dongDuocXuLy` là CHỐT CHẶN, không phải trang trí (14/10/2026 — Đức báo modal "Cần đối
 * soát" tự đóng và nhảy sang trang chi tiết). Modal dựng trong một ô của dòng này đi qua
 * portal, nhưng sự kiện React vẫn nổi bọt theo cây component: click bất kỳ đâu trong modal —
 * kể cả vào ô nhập — chạm `onClick` ở đây và `router.push` đi; gõ DẤU CÁCH chạm `onKeyDown`
 * và cũng đi. Người dùng mất sạch chữ đang gõ mà không hiểu vì sao.
 */
export function OrderRow({ href, ariaLabel, className, children }: {
  href: string;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const go = () => router.push(href);
  return (
    <tr
      className={`cursor-pointer ${className ?? ''}`}
      tabIndex={0}
      role="link"
      aria-label={ariaLabel}
      onClick={(e) => { if (dongDuocXuLy(e)) go(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!dongDuocXuLy(e)) return;
        if (e.key === ' ') e.preventDefault();
        go();
      }}
    >
      {children}
    </tr>
  );
}
