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
  const gv = p.giaVon;
  const tongDong = detail.lines.length;
  const dongThuc = detail.lines.filter((l) => l.giaVonThucVnd != null).length;
  const soDongThuc = dongThuc > 0 && dongThuc < tongDong ? ` ${dongThuc}/${tongDong} dòng` : '';
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
            <Row label="SP — vốn dự tính (bảng giá brand)" value={gv.duTinhVnd == null ? 'thiếu' : vnd(gv.duTinhVnd)} muted={gv.dung === 'thuc'} />
            <Row
              label={`SP — vốn thực (bảng kê đã chốt)${soDongThuc}`}
              value={gv.thucVnd == null ? 'chưa đối soát' : vnd(gv.thucVnd)}
              amber={gv.thucVnd != null && gv.dung !== 'thuc'}
            />
            <div className={`flex justify-between font-semibold border-t border-border/60 pt-1 ${cell(mp.loss, mp.missing)}`}>
              <span>{mp.missing ? 'Margin SP' : `${mp.loss ? '⚠' : '✓'} Margin SP ${gv.dung === 'thuc' ? '(theo giá thực)' : '(theo dự tính)'}`}</span>
              {mp.missing ? <span>—</span> : <SoVaPct so={`${mp.deltaVnd >= 0 ? '+' : ''}${vnd(mp.deltaVnd)}`} pct={pctTxt(mp.pct)} />}
            </div>
          </div>
          <div className={`rounded-lg border p-2.5 space-y-0.5 ${ms.loss ? 'border-red-500/40 bg-red-500/5' : 'border-border'}`}>
            <Row label="Ship — thu khách" value={vnd(ms.revenueVnd)} />
            <Row label={`Ship — DHL/FedEx${ms.source === 'engine' ? ' (tạm tính)' : ''}`} value={ms.missing ? 'chưa có' : vnd(ms.costVnd)} />
            <div className={`flex justify-between font-semibold border-t border-border/60 pt-1 ${cell(ms.loss, ms.missing)}`}>
              <span>{ms.missing ? 'Margin Ship' : ms.loss ? '⚠ Margin Ship' : '✓ Margin Ship'}</span>
              {ms.missing ? <span>—</span> : <SoVaPct so={`${ms.deltaVnd >= 0 ? '+' : ''}${vnd(ms.deltaVnd)}`} pct={pctTxt(ms.pct)} />}
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
          {p.revenueVnd == null ? 'thiếu dữ liệu' : <SoVaPct so={vnd(p.revenueVnd)} pct={`${pctTxt(p.revenuePct)} / GMV`} lon />}
        </span>
      </div>
    </div>
  );
}

/** Số tiền là chính (đậm, tabular), phần trăm là phụ: chữ nhỏ hơn, mờ 55 %, cách một khoảng — CEO 09/09: "số là chính, phần trăm là phụ".
 *  Ngăn cách bằng khoảng trắng thay dấu "·" để hai con số không dính vào nhau. */
function SoVaPct({ so, pct, lon }: { so: string; pct: string; lon?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-2 tabular-nums">
      <span>{so}</span>
      {pct && <span className={`font-normal opacity-55 ${lon ? 'text-sm' : 'text-[11px]'}`}>{pct}</span>}
    </span>
  );
}

function Row({ label, value, red, amber, muted }: { label: string; value: string; red?: boolean; amber?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${red ? 'text-red-600 dark:text-red-400' : amber ? 'text-amber-600 dark:text-amber-400' : muted ? 'text-muted-foreground/70' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
