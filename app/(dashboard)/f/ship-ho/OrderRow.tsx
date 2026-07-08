'use client';

import { useRouter } from 'next/navigation';

/**
 * Row bảng đơn ship hộ: click BẤT KỲ chỗ nào trên row → mở chi tiết đơn
 * (không chỉ link ở cột Mã). Hỗ trợ bàn phím (Enter/Space).
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
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.key === ' ') e.preventDefault();
          go();
        }
      }}
    >
      {children}
    </tr>
  );
}
