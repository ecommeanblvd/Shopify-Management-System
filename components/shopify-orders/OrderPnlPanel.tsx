'use client';
import type { OrderDetail } from '@/features/shopify-orders/order-actions';

const vnd = (n: number | null | undefined) =>
  n == null ? '—' : `₫${Math.round(n).toLocaleString('vi-VN')}`;
const pctTxt = (n: number | null | undefined) => (n == null ? '' : `${n.toFixed(1)}%`);

export function OrderPnlPanel({ detail }: { detail: OrderDetail }) {
  const p = detail.pnl;
  if (!p) {
    return (
      <div className="rounded-lg border border-amber-400/50 bg-amber-50/40 dark:bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
        Chưa đặt tỉ giá cho store → không quy đổi được sang VND. Đặt tỉ giá để xem P&L.
      </div>
    );
  }
  const mp = p.marginSp;
  const ms = p.marginShip;
  const cell = (loss: boolean, missing: boolean) =>
    missing ? 'text-muted-foreground' : loss ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
  const revState = p.revenueVnd == null ? 'na' : p.revenueVnd >= 0 ? 'pos' : 'neg';
  const revBorder = revState === 'na' ? 'border-amber-400/50 bg-amber-50/30 dark:bg-amber-500/5'
    : revState === 'pos' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-red-500/50 bg-red-500/5';
  const revText = revState === 'na' ? 'text-amber-700 dark:text-amber-300'
    : revState === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="space-y-4 text-sm">
      {/* CÂN ĐỐI MARGIN */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Cân đối margin — đã đủ chưa?</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-2.5 space-y-0.5">
            <Row label="SP — bán" value={vnd(mp.revenueVnd)} />
            <Row label="SP — vốn" value={mp.missing ? 'thiếu giá vốn' : vnd(mp.costVnd)} />
            <div className={`flex justify-between font-semibold border-t border-border/60 pt-1 ${cell(mp.loss, mp.missing)}`}>
              <span>{mp.missing ? 'Margin SP' : mp.loss ? '⚠ Margin SP' : '✓ Margin SP'}</span>
              <span>{mp.missing ? '—' : `${mp.deltaVnd >= 0 ? '+' : ''}${vnd(mp.deltaVnd)} · ${pctTxt(mp.pct)}`}</span>
            </div>
          </div>
          <div className={`rounded-lg border p-2.5 space-y-0.5 ${ms.loss ? 'border-red-500/40 bg-red-500/5' : 'border-border'}`}>
            <Row label="Ship — thu khách" value={vnd(ms.revenueVnd)} />
            <Row label={`Ship — DHL/FedEx${ms.source === 'engine' ? ' (tạm tính)' : ''}`} value={ms.missing ? 'chưa có' : vnd(ms.costVnd)} />
            <div className={`flex justify-between font-semibold border-t border-border/60 pt-1 ${cell(ms.loss, ms.missing)}`}>
              <span>{ms.missing ? 'Margin Ship' : ms.loss ? '⚠ Margin Ship' : '✓ Margin Ship'}</span>
              <span>{ms.missing ? '—' : `${ms.deltaVnd >= 0 ? '+' : ''}${vnd(ms.deltaVnd)} · ${pctTxt(ms.pct)}`}</span>
            </div>
          </div>
        </div>
        {ms.loss && (
          <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">⚠ Ship đang lỗ — set-up phí ship chưa đủ cover carrier cho đơn/zone này.</p>
        )}
      </div>

      {/* P&L hai cột */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-2.5 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold">Thu (khách trả)</div>
          <Row label="Giá bán + Ship" value={vnd(p.gmvVnd)} />
          <Row label="− Discount/Refund" value={vnd(p.gmvVnd - p.thuThuanVnd)} red />
          <div className="flex justify-between font-semibold border-t border-border/60 pt-1"><span>= Thu thuần</span><span>{vnd(p.thuThuanVnd)}</span></div>
        </div>
        <div className="rounded-lg border border-border p-2.5 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400 font-semibold">Chi (trả đối tác)</div>
          <Row label="Giá vốn + Ship" value={p.tongChiVnd == null ? '—' : vnd(p.marginSp.costVnd + p.marginShip.costVnd)} />
          <Row label="Transaction fee" value={p.feeMissing ? 'chưa có phí GD' : vnd(p.costFeeVnd)} amber />
          <div className="flex justify-between font-semibold border-t border-border/60 pt-1"><span>= Tổng chi</span><span>{vnd(p.tongChiVnd)}</span></div>
        </div>
      </div>

      {/* Revenue banner */}
      <div className={`flex items-center justify-between rounded-lg border p-3 ${revBorder}`}>
        <span className={`font-bold ${revText}`}>REVENUE mình tạo ra</span>
        <span className={`font-bold text-lg ${revText}`}>
          {p.revenueVnd == null ? 'thiếu dữ liệu' : `${vnd(p.revenueVnd)} · ${pctTxt(p.revenuePct)} / GMV`}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, red, amber }: { label: string; value: string; red?: boolean; amber?: boolean }) {
  return (
    <div className={`flex justify-between ${red ? 'text-red-600 dark:text-red-400' : amber ? 'text-amber-600 dark:text-amber-400' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
