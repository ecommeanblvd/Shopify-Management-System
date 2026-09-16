'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CreditNoteRow, CreditNoteThang } from './CreditNoteCard';

const tien = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;

/**
 * Dòng tóm tắt hoá đơn điều chỉnh + modal chi tiết (CEO 16/09/2026).
 *
 * Trước đây cả bảng chứng từ trải thẳng ra đầu trang Đối soát và đẩy phần đối soát từng kiện —
 * việc chính của trang — xuống dưới màn hình. Chứng từ điều chỉnh chỉ cần nhìn con số, khi nào
 * muốn soát từng tờ mới mở ra.
 */
export function CreditNoteDetailDialog({ rows, tongThang }: { rows: CreditNoteRow[]; tongThang: CreditNoteThang[] }) {
  const [open, setOpen] = useState(false);
  const moiNhat = tongThang[0];
  const nhanThang = (t: CreditNoteThang) =>
    `${t.thang}: thu hồi ${tien(t.tong)} (${t.n})${t.tongDebit ? ` · trả thêm ${tien(t.tongDebit)} (${t.nDebit})` : ''}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={rows.length === 0}
        className="group flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Hoá đơn điều chỉnh carrier</span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {rows.length === 0
              ? 'Chưa nhập chứng từ nào'
              : <>
                  {moiNhat && <span className="font-medium text-emerald-600 dark:text-emerald-400">{nhanThang(moiNhat)}</span>}
                  {tongThang.length > 1 && <> · {tongThang.length - 1} tháng trước</>}
                  {' · '}{rows.length} chứng từ gần nhất
                </>}
          </span>
        </span>
        {rows.length > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
            Xem chi tiết <ChevronRight className="size-3.5" />
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hoá đơn điều chỉnh carrier (credit / billing note)</DialogTitle>
            <DialogDescription className="text-[11px] leading-relaxed">
              Chứng từ ĐIỀU CHỈNH một hoá đơn đã xuất: carrier trả lại tiền (credit note) hoặc thu thêm (billing note).
              Hệ thống tự tách hai loại, tiền tính theo NGÀY TRÊN HOÁ ĐƠN, một hoá đơn VAT là một chứng từ; credit note
              là số vào KPI Pillar 3. Hoá đơn cước kỳ hàng tháng thì dùng nút “Thêm hoá đơn cước kỳ” ở góc trên — nó vào
              công nợ và đối soát từng kiện, khác hẳn chỗ này.
            </DialogDescription>
          </DialogHeader>

          {tongThang.length > 0 && (
            <ul className="grid gap-1 text-xs tabular-nums sm:grid-cols-2">
              {tongThang.map((t) => (
                <li key={t.thang} className="rounded-md border border-border px-2.5 py-1.5">{nhanThang(t)}</li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="text-left">Hoá đơn</th><th className="text-left">Loại</th><th className="text-right">Ngày</th>
                  <th className="text-right">Số tiền</th><th className="text-right">Kiện liên quan</th><th className="text-left">Tệp nguồn</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mau = r.loai === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
                  return (
                    <tr key={r.id} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-1.5">
                      <td className="text-left font-medium">{r.kyHieu}-{r.soHoaDon}</td>
                      <td className={`text-left text-xs ${mau}`}>{r.loai === 'credit' ? 'Credit note' : 'Billing note'}</td>
                      <td className="text-right">{r.ngay}</td>
                      <td className={`text-right font-medium ${mau}`}>{r.loai === 'credit' ? '+' : '−'}{tien(Math.abs(r.tongCong))}</td>
                      <td className="text-right text-muted-foreground">{r.soDong || '—'}</td>
                      <td className="text-left text-[11px] text-muted-foreground">{r.tenFile ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
