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
  /* Lưu KÈM KHOÁ của lượt gọi, không lưu mảng trần.
   *
   * Bản cũ `setDs([])` ngay trong thân effect: vừa là tác dụng phụ đồng bộ khiến
   * React render thêm một lượt thừa, vừa GIẤU một lỗi thật — đổi từ đơn A sang
   * đơn B thì dữ liệu của A vẫn hiện cho tới khi lượt gọi của B về, tức người
   * dùng nhìn thấy hồ sơ của ĐƠN KHÁC gắn tên đơn đang mở. So khoá lúc render
   * thì dữ liệu lệch đơn không bao giờ hiện được, và không cần setState nào để dọn. */
  const khoa = `${maDon ?? ''}|${boQua}`;
  const [kq, setKq] = useState<{ khoa: string; ds: LienQuan[] } | null>(null);

  useEffect(() => {
    if (!maDon) return;
    let huy = false;
    void (async () => {
      const r = await hoSoLienQuan(maDon, boQua).catch((e) => {
        // Dải này là thông tin PHỤ: hỏng thì im lặng bỏ qua, không được làm modal
        // chính hiện lỗi hay trống.
        console.error('[cx] hồ sơ liên quan lỗi:', e);
        return [] as LienQuan[];
      });
      if (!huy) setKq({ khoa: `${maDon}|${boQua}`, ds: r });
    })();
    return () => { huy = true; };
  }, [maDon, boQua]);

  const ds = maDon && kq?.khoa === khoa ? kq.ds : [];
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
