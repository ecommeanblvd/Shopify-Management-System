'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { hoSoLienQuan, type LienQuan } from '@/features/cx/lien-quan';

/**
 * Dải "đơn này còn hồ sơ gì ở module khác".
 *
 * KHÔNG hiện gì khi không có — đo 28/09 thì 97,6% đơn chỉ có hồ sơ ở một module,
 * nên một dòng "không có hồ sơ liên quan" sẽ hiện gần như mọi lần mở và chỉ làm nhiễu.
 */
export function DaiLienQuan({ maDon, boQua }: { maDon: string | null; boQua: string }) {
  const [ds, setDs] = useState<LienQuan[]>([]);

  useEffect(() => {
    if (!maDon) { setDs([]); return; }
    let huy = false;
    void (async () => {
      const r = await hoSoLienQuan(maDon, boQua).catch((e) => {
        // Dải này là thông tin PHỤ: hỏng thì im lặng bỏ qua, không được làm modal
        // chính hiện lỗi hay trống.
        console.error('[cx] hồ sơ liên quan lỗi:', e);
        return [] as LienQuan[];
      });
      if (!huy) setDs(r);
    })();
    return () => { huy = true; };
  }, [maDon, boQua]);

  if (ds.length === 0) return null;

  return (
    <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
      <span className="font-medium">Đơn {maDon} còn: </span>
      {ds.map((x, i) => (
        <span key={x.module}>
          {i > 0 && ' · '}
          <Link href={x.href} className="underline">
            {x.so} {x.ten}
          </Link>
        </span>
      ))}
    </p>
  );
}
