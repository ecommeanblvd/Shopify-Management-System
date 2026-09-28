'use client';

import { useState } from 'react';
import Link from 'next/link';
import { chuoiTongTien } from '@/features/dispute/tong-tien';
import type { TongQuanCx } from '@/features/cx/tong-quan';
import type { KhoiViec, Viec } from '@/features/cx/uu-tien';

/** Nhãn hạn: quá hạn thì đỏ, ≤3 ngày đỏ, ≤7 ngày vàng, còn lại xám. */
function nhanHan(v: Viec): { chu: string; mau: string } | null {
  if (v.conLai == null) return null;
  if (v.conLai < 0) {
    return { chu: `quá hạn ${-v.conLai} ngày`, mau: 'bg-red-500/15 text-red-700 dark:text-red-400' };
  }
  if (v.conLai <= 3) {
    return { chu: `còn ${v.conLai} ngày`, mau: 'bg-red-500/15 text-red-700 dark:text-red-400' };
  }
  if (v.conLai <= 7) {
    return { chu: `còn ${v.conLai} ngày`, mau: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' };
  }
  return { chu: `còn ${v.conLai} ngày`, mau: 'bg-muted text-muted-foreground' };
}

function Khoi({ k }: { k: KhoiViec }) {
  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">{k.ten}</h3>
        <span className="text-sm font-medium tabular-nums">{k.tong}</span>
        {k.hauQua && <span className="text-xs text-muted-foreground">{k.hauQua}</span>}
        <Link href={k.href} className="ml-auto shrink-0 text-xs underline">xem tất cả</Link>
      </div>
      <ul className="divide-y divide-border">
        {k.viec.map((v) => {
          const h = nhanHan(v);
          return (
            <li key={v.id}>
              <Link href={v.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-muted/50">
                {h && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${h.mau}`}>{h.chu}</span>}
                <span className="min-w-0 flex-1 truncate text-sm">{v.nhan}</span>
                {v.phu && (
                  <span className="shrink-0 truncate text-xs text-muted-foreground">{v.phu}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {k.tong > k.viec.length && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          còn {k.tong - k.viec.length} việc nữa
        </p>
      )}
    </section>
  );
}

/**
 * Trang "Hôm nay".
 *
 * Tách tồn đọng khỏi việc phát sinh theo đúng nguyên tắc CEO chọn ở workspace nhận
 * hàng 25/09. Đo 28/09: 204 việc đang treo và TOÀN BỘ là hồ sơ nhập từ Lark — dồn
 * chung là mỗi sáng CX mở ra thấy 204 dòng rồi bỏ qua cả trang.
 */
export function TrangHomNay({ tq }: { tq: TongQuanCx }) {
  const [moTonDong, setMoTonDong] = useState(false);
  const { xep, soLieu, khongXemDuoc } = tq;

  return (
    <div className="space-y-6">
      {/* Dải số liệu — tiền TÁCH theo đơn vị, không cộng gộp. */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 rounded-lg border border-border p-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Cần làm ngay</p>
          <p className="text-2xl font-semibold tabular-nums">{xep.tongNgay}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Tồn đọng từ Lark</p>
          <p className="text-2xl font-semibold tabular-nums text-muted-foreground">{xep.tongTonDong}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Tranh chấp đang mở</p>
          <p className="text-sm font-medium tabular-nums">{chuoiTongTien(soLieu.tranhChapDangMo)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Thiệt hại sự cố tháng này</p>
          <p className="text-sm font-medium tabular-nums">{chuoiTongTien(soLieu.thietHaiThangNay)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Đánh giá 1 sao tháng này</p>
          <p className="text-sm font-medium tabular-nums">{soLieu.motSaoThangNay}</p>
        </div>
      </div>

      {khongXemDuoc.length > 0 && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Vai trò của bạn không xem được: {khongXemDuoc.join(' · ')}. Số trên trang này
          đã trừ các phần đó.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Cần làm ngay</h2>
        {xep.ngay.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Không có việc nào cần làm ngay. Việc có hạn cứng luôn hiện ở đây kể cả khi
            là hồ sơ nhập từ Lark.
          </p>
        ) : (
          xep.ngay.map((k) => <Khoi key={k.loai} k={k} />)
        )}
      </section>

      {xep.tonDong.length > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setMoTonDong((v) => !v)}
            aria-expanded={moTonDong}
            className="flex w-full cursor-pointer items-baseline gap-3 rounded-lg border border-border px-4 py-3 text-left hover:bg-muted/50"
          >
            <h2 className="text-base font-semibold">Tồn đọng từ Lark</h2>
            <span className="text-sm font-medium tabular-nums">{xep.tongTonDong}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              hồ sơ nhập từ bảng Lark, không có hạn cứng — rà dần, không phải việc hôm nay
            </span>
            <span className="shrink-0 text-xs underline">{moTonDong ? 'thu lại' : 'mở ra'}</span>
          </button>
          {moTonDong && xep.tonDong.map((k) => <Khoi key={k.loai} k={k} />)}
        </section>
      )}
    </div>
  );
}
