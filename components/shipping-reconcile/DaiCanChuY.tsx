'use client';
import { useState } from 'react';
import Link from 'next/link';
// CHỈ import type — mấy module này kéo db/schema (server). Dải là 'use client' nên import
// VALUE sẽ lôi db vào client bundle (build fail). Tóm tắt tính ở page (RSC) rồi truyền xuống.
import type { UnmatchedBilledRow, UnmatchedSummary } from '@/features/shipments/unmatched-billed';
import type { DongGiaoTruoc, TomTatGiaoTruoc } from '@/features/shipments/giao-truoc-ngay-gui';
import type { LarkRunRow } from '@/features/lark/sync';
import type { CreditNoteRow, CreditNoteThang } from '@/components/carrier-rates/CreditNoteCard';
import { CreditNoteDetailDialog } from '@/components/carrier-rates/CreditNoteDetailDialog';
import { CreditNoteUpload } from '@/components/carrier-rates/CreditNoteUpload';
import { tomTatChip, gopMaTheoDon } from '@/features/shipments/unmatched-chip';
import { ChiTietGiaoTruoc } from './ChiTietGiaoTruoc';

const fmt = (n: number | null) => n === null ? '—' : Math.round(n).toLocaleString('vi-VN');
const gonTien = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}tr` : fmt(n);

type Muc = 'giaoTruoc' | 'lark' | 'shipho' | 'hoan' | 'la';

/**
 * Dải "cần chú ý" — MỘT hàng chip ở đầu màn Đối soát ship.
 *
 * CEO (20/10/2026): *"Phần này của Đối soát phí ship cũng đang bị quá dày trong khi chỗ cần
 * làm việc bị tụt hẳn xuống dưới"*. Trước đó ba khối riêng xếp dọc — banner "giao trước ngày
 * gửi", thẻ hoá đơn điều chỉnh, dải tracking chưa khớp — mỗi khối cách nhau 24px, đẩy bảng
 * đối soát xuống gần 900px. Ba khối đó cùng MỘT bản chất: việc đang chờ xử lý. Nên gộp vào
 * một hàng chip, mặc định thu lại, bấm mới mở chi tiết.
 *
 * Không con số nào bị bỏ: con số lớn nhất của mỗi nhóm nằm trên chip, phần chi tiết (mã
 * nào, kỳ nào, lệch mấy ngày) nằm trong panel mở ra bên dưới — xem từng `ChiTiet*`.
 *
 * Mở nhóm này thì nhóm kia tự đóng: chiều cao dải luôn là một hàng chip + tối đa một panel,
 * nếu không thì mở hai ba nhóm là lại thành cái stack dày vừa gỡ.
 */
export function DaiCanChuY({
  rows, summary, shipHoRows = [], returnRows = [], lark = null, giaoTruoc, tomTatGiaoTruoc,
  creditNotes, creditNoteThang,
}: {
  rows: UnmatchedBilledRow[]; summary: UnmatchedSummary;
  /** Tracking thuộc đơn ship hộ — không phải tracking "lạ", chỉ hiện info riêng. */
  shipHoRows?: UnmatchedBilledRow[];
  /** Dòng bill là cước HÀNG HOÀN của đơn đã biết — hiện info riêng kèm đơn gốc. */
  returnRows?: UnmatchedBilledRow[];
  /** Lần đồng bộ Lark gần nhất — vào chung dải chip cho gọn; riêng khi LỖI thì
   *  tách ra banner đỏ vì đó là việc cần xử lý ngay, không nên giấu sau một cú bấm. */
  lark?: LarkRunRow | null;
  /** Kiện ghi ngày giao TRƯỚC ngày gửi — dữ liệu sai, xem `ChiTietGiaoTruoc`. */
  giaoTruoc: DongGiaoTruoc[];
  tomTatGiaoTruoc: TomTatGiaoTruoc;
  creditNotes: CreditNoteRow[];
  creditNoteThang: CreditNoteThang[];
}) {
  const [mo, setMo] = useState<Muc | null>(null);
  const bat = (m: Muc) => setMo((v) => (v === m ? null : m));

  const shipHo = tomTatChip(shipHoRows);
  const hoan = tomTatChip(returnRows);
  const la = tomTatChip(rows);
  const larkLoi = lark?.error ? lark : null;
  const larkOk = lark && !lark.error ? lark : null;

  const chip = (m: Muc, mau: string, noiDung: React.ReactNode) => (
    <button
      type="button"
      onClick={() => bat(m)}
      aria-expanded={mo === m}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${mau}`}
    >
      {noiDung}
      <span className="opacity-60">{mo === m ? '▲' : '▼'}</span>
    </button>
  );

  return (
    <>
      {larkLoi && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          Đồng bộ Lark LỖI ({new Date(larkLoi.ranAt).toLocaleString('vi-VN')}): {larkLoi.error}
        </div>
      )}
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {giaoTruoc.length > 0 && chip('giaoTruoc', 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
            <>⚠ {tomTatGiaoTruoc.tong} kiện ghi ngày giao TRƯỚC ngày gửi</>)}
          {larkOk && chip('lark', 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20',
            <>Lark {new Date(larkOk.ranAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {larkOk.updated} cập nhật{larkOk.unmatchedCount > 0 ? ` · ${larkOk.unmatchedCount} không khớp` : ''}</>)}
          {shipHo.soDong > 0 && chip('shipho', 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20',
            <>🚚 {shipHo.soDong} tracking đơn ship hộ</>)}
          {hoan.soDong > 0 && chip('hoan', 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20',
            <>↩️ {hoan.soDong} cước hàng hoàn · {gonTien(hoan.tongVnd)}đ</>)}
          {la.soDong > 0 && chip('la', 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
            <>⚠ {la.soDong} tracking chưa khớp · {gonTien(la.tongVnd)}đ</>)}
          {la.soDong > 0 && (
            <a href="/f/shipping-reconcile/unmatched-billed.csv" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">Tải CSV</a>
          )}
          {/* Chứng từ điều chỉnh là NHÓM KHÁC với mấy chip trên (việc chờ xử lý vs. tiền đã
              thu hồi về) — một vạch mảnh đủ nói điều đó mà không tốn thêm một hàng. */}
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <CreditNoteDetailDialog rows={creditNotes} tongThang={creditNoteThang} gon />
          <CreditNoteUpload />
        </div>

        {mo === 'giaoTruoc' && giaoTruoc.length > 0 && (
          <div className="mt-2">
            <ChiTietGiaoTruoc rows={giaoTruoc} tomTat={tomTatGiaoTruoc} />
          </div>
        )}

        {mo === 'lark' && larkOk && (
          <div className="mt-2 text-xs text-muted-foreground">
            <p>Chạy lúc {new Date(larkOk.ranAt).toLocaleString('vi-VN')} — tạo {larkOk.created} · cập nhật {larkOk.updated} · không khớp {larkOk.unmatchedCount} · bỏ qua {larkOk.skippedCount}</p>
            {larkOk.unmatched.length > 0 && (
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                {larkOk.unmatched.map((u, i) => <li key={`${u.orderNumber}-${i}`}>{u.orderNumber} — {u.reason}</li>)}
              </ul>
            )}
          </div>
        )}

        {mo === 'shipho' && (
          <div className="mt-2 text-xs text-muted-foreground">
            <p className="mb-1">Đối soát tự động ở <Link href="/f/ship-ho" className="underline">module Ship hộ</Link>, không phải tracking lạ.</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
              {gopMaTheoDon(shipHoRows, (r) => r.shipHoCode).map((x) => (
                <span key={x.ma}>{x.ma}{x.soTracking > 1 ? ` (${x.soTracking} kiện)` : ''}</span>
              ))}
            </div>
          </div>
        )}

        {mo === 'hoan' && (
          <div className="mt-2 text-xs text-muted-foreground">
            <p className="mb-1">Đã gắn về đơn gốc, tính vào chi phí ship của đơn.</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {gopMaTheoDon(returnRows, (r) => r.returnOfOrderNumber).map((x) => (
                <span key={x.ma} className="font-mono">{x.ma} <span className="tabular-nums">({fmt(x.tongVnd)}đ)</span></span>
              ))}
            </div>
          </div>
        )}

        {mo === 'la' && (
          <div className="mt-2 overflow-x-auto">
            <p className="mb-1 text-xs text-muted-foreground">
              Chưa khớp shipment nào — kiểm tra tracking vận hành
              {summary.byCarrier.length > 0 && ` · ${summary.byCarrier.map((c) => `${c.carrierKey ?? '—'}: ${c.count} (${fmt(c.sumVnd)}đ)`).join(' · ')}`}
            </p>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left"><th className="py-1 pr-3">Tracking</th><th className="py-1 pr-3">Hoá đơn</th><th className="py-1 pr-3">Carrier/Account</th><th className="py-1 pr-3">Số tiền</th><th className="py-1 pr-3">Kỳ</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tracking} className="border-t border-border/60">
                    <td className="py-1 pr-3 font-mono">{r.tracking}</td>
                    <td className="py-1 pr-3">{r.billNumber ?? '—'}</td>
                    <td className="py-1 pr-3">{r.carrierKey ?? '—'} · {r.accountName}</td>
                    <td className="py-1 pr-3 tabular-nums">{fmt(r.amountVnd)}</td>
                    <td className="py-1 pr-3">{r.billPeriodStart ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
