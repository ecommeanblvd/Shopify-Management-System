import { Card, CardContent } from '@/components/ui/card';
import { CreditNoteUpload } from './CreditNoteUpload';

export interface CreditNoteRow {
  id: string; soHoaDon: string; kyHieu: string; ngay: string; tongCong: number; soDong: number; tenFile: string | null;
  loai: 'credit' | 'debit';
}

const tien = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;

/** Khối credit note trên trang Đối soát: tải tệp + danh sách đã nhập, cộng theo tháng của NGÀY HOÁ ĐƠN. */
export function CreditNoteCard({ rows, tongThang }: {
  rows: CreditNoteRow[];
  tongThang: Array<{ thang: string; tong: number; n: number; tongDebit: number; nDebit: number }>;
}) {
  return (
    <Card><CardContent className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Hoá đơn điều chỉnh carrier</div>
          <p className="text-[11px] text-muted-foreground">
            Tải hết vào đây, hệ thống tự tách credit note (carrier trả lại) và billing note (mình trả thêm). Tiền tính theo
            NGÀY TRÊN HOÁ ĐƠN; một hoá đơn VAT là một chứng từ. Riêng credit note là số vào KPI Pillar 3.
          </p>
        </div>
        {tongThang.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {tongThang.map((t) => `${t.thang}: thu hồi ${tien(t.tong)} (${t.n})${t.tongDebit ? ` · trả thêm ${tien(t.tongDebit)} (${t.nDebit})` : ''}`).join(' · ')}
          </div>
        )}
      </div>

      <CreditNoteUpload />

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Hoá đơn</th><th className="text-left">Loại</th><th className="text-right">Ngày</th><th className="text-right">Số tiền</th>
                <th className="text-right">Kiện liên quan</th><th className="text-left">Tệp nguồn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-1.5">
                  <td className="text-left font-medium">{r.kyHieu}-{r.soHoaDon}</td>
                  <td className={`text-left text-xs ${r.loai === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {r.loai === 'credit' ? 'Credit note' : 'Billing note'}
                  </td>
                  <td className="text-right">{r.ngay}</td>
                  <td className={`text-right font-medium ${r.loai === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {r.loai === 'credit' ? '+' : '−'}{tien(Math.abs(r.tongCong))}
                  </td>
                  <td className="text-right text-muted-foreground">{r.soDong || '—'}</td>
                  <td className="text-left text-[11px] text-muted-foreground">{r.tenFile ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardContent></Card>
  );
}
