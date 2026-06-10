'use client';

import { useState } from 'react';
import type { ReconcileViewRow } from '@/features/shipments/reconcile-view';
import { setReconcileStatus, clearReconcileStatus } from '@/features/shipments/reconcile-status-actions';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

const CAUSE_LABEL: Record<string, string> = {
  KHOP: '', SAI_CAN: 'sai cân', THIEU_CAU_HINH_REMOTE: 'thiếu cấu hình vùng xa',
  REMOTE_KHONG_KHOP: 'remote không khớp', LECH_RATE_CARD: 'lệch rate card',
  LECH_CHIET_KHAU: 'lệch chiết khấu', LECH_FUEL: 'lệch % fuel',
  SAI_ZONE: 'lệch zone', PHAI_SINH_ZONE: 'khớp theo zone bill',
  PHAI_SINH: 'phái sinh', KHONG_KHOP: 'không khớp', LAM_TRON: 'làm tròn',
};

function severityClass(s: string): string {
  switch (s) {
    case 'match': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'weight': return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'zone': return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'config': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'ratecard': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'discount': return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

type CompKey = 'base' | 'fuel' | 'remote' | 'demand' | 'signature' | 'gogreen' | 'vat' | 'elevatedRisk';

interface ComponentLine {
  label: string;
  billed: number | null;
  engine: number | null;
  /** Diagnosis component key this display line maps to. */
  compKey: CompKey;
}

/** Sum engine sub-charges that share a display line, preserving null when the
 *  engine produced no quote (every part null). */
function sumEngine(...parts: Array<number | null>): number | null {
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((a, p) => a + (p ?? 0), 0);
}

function lines(row: ReconcileViewRow): ComponentLine[] {
  return [
    { label: 'Cước gốc (sau giảm giá)', billed: row.billedBaseNet, engine: row.engineBaseNet, compKey: 'base' },
    { label: 'Phụ phí xăng dầu (fuel)', billed: row.billedFuel, engine: row.engineFuel, compKey: 'fuel' },
    { label: 'Vùng xa (remote)', billed: row.billedRemote, engine: row.engineRemote, compKey: 'remote' },
    { label: 'Phụ phí nhu cầu (demand)', billed: row.billedDemand, engine: row.engineDemand, compKey: 'demand' },
    // signature: engine books DHL's fee under peak_fixed, FedEx under residential_fixed.
    { label: 'Ký nhận (signature)', billed: row.billedSignature, engine: sumEngine(row.engineResidential, row.enginePeak), compKey: 'signature' },
    // gogreen: engine books DHL GoGreen under per_step_fixed.
    { label: 'GoGreen', billed: row.billedGogreen, engine: row.enginePerStep, compKey: 'gogreen' },
    { label: 'VAT', billed: row.billedVat, engine: row.engineVat, compKey: 'vat' },
    // elevated risk: engine books DHL ER / Restricted Destination under country_fixed.
    { label: 'Phụ phí rủi ro (ER)', billed: row.billedElevatedRisk, engine: row.engineCountryFixed, compKey: 'elevatedRisk' },
  ];
}

export function ReconcileDetailPanel({ row }: { row: ReconcileViewRow }) {
  if (row.engineTotal === null) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-sm text-amber-600 dark:text-amber-400">
          Hệ thống chưa tính được giá cho đơn này (lý do: {row.engineReason ?? 'không rõ'}). Không có số liệu để đối soát từng khoản.
        </div>
        <ReconcileActions row={row} />
      </div>
    );
  }
  return (
    <div className="p-4">
      {row.diagnosis && (
        <div className="mb-4 space-y-2">
          <div className={`rounded-md px-3 py-2 text-sm font-medium ${severityClass(row.diagnosis.severity)}`}>
            {row.diagnosis.verdict}
          </div>
          {row.diagnosis.impliedWeight && (
            <p className="text-xs text-muted-foreground">
              Truy ngược: carrier tính như thể{' '}
              <span className="font-semibold">
                {row.diagnosis.impliedWeight.rangeKg[0]}–{row.diagnosis.impliedWeight.rangeKg[1]} kg
              </span>{' '}
              (bậc ≤ {row.diagnosis.impliedWeight.tierUpperKg} kg), hệ thống dùng{' '}
              <span className="font-semibold">{row.diagnosis.impliedWeight.engineChargeableKg} kg</span>
              {row.diagnosis.impliedWeight.deltaTiers > 0 ? ` — lệch ${row.diagnosis.impliedWeight.deltaTiers} bậc` : ''}.
            </p>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1">Khoản phí</th>
            <th className="text-right py-1">Billed</th>
            <th className="text-right py-1">Hệ thống</th>
            <th className="text-right py-1">Lệch</th>
            <th className="text-right py-1">Chẩn đoán</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {lines(row).map((l) => {
            // NULL one side = the bill/engine simply has no such line —
            // numerically 0, so the gap must still surface (e.g. engine
            // charges ER 918,000 the invoice never billed). Only show '—'
            // when BOTH sides are empty.
            const delta = l.billed === null && l.engine === null
              ? null
              : (l.billed ?? 0) - (l.engine ?? 0);
            const comp = row.diagnosis?.components.find((x) => x.key === l.compKey);
            const causeLabel = comp && comp.cause !== 'KHOP' ? CAUSE_LABEL[comp.cause] : '';
            return (
              <tr key={l.label} className="border-t border-border">
                <td className="py-1 font-sans">{l.label}</td>
                <td className="py-1 text-right">{fmtVnd(l.billed)}</td>
                <td className="py-1 text-right">{fmtVnd(l.engine)}</td>
                <td className={`py-1 text-right ${delta && Math.abs(delta) > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {fmtVnd(delta)}
                </td>
                <td className="py-1 text-right font-sans text-[11px] text-muted-foreground">{causeLabel}</td>
              </tr>
            );
          })}
          {(() => {
            // Residual = whatever the engine total includes that no display line
            // above accounts for (e.g. country_fixed). Surfaced so the rows
            // always reconcile to the total instead of hiding money.
            const res = row.diagnosis?.components.find((x) => x.key === 'residual');
            if (!res || res.delta === 0) return null;
            return (
              <tr className="border-t border-border">
                <td className="py-1 font-sans">Khác / làm tròn</td>
                <td className="py-1 text-right text-muted-foreground">—</td>
                <td className="py-1 text-right text-muted-foreground">—</td>
                <td className="py-1 text-right">{fmtVnd(res.delta)}</td>
                <td className="py-1 text-right font-sans text-[11px] text-muted-foreground">{CAUSE_LABEL[res.cause] ?? ''}</td>
              </tr>
            );
          })()}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-1 font-sans">Tổng</td>
            <td className="py-1 text-right">{fmtVnd(row.billedTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.engineTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.deltaVnd)}</td>
            <td className="py-1"></td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Giảm giá hợp đồng đã được gộp vào &quot;Cước gốc (sau giảm giá)&quot;. Billed gốc trên hóa đơn: {fmtVnd(row.billedBase)} − giảm {fmtVnd(row.billedDiscount)}.
      </p>
      <ReconcileActions row={row} />
    </div>
  );
}

/**
 * Per-shipment resolution block. Action chỉ nằm ở đây (không ở row ngoài
 * bảng) để bắt buộc operator mở chi tiết soi từng khoản trước khi chốt.
 * Đơn LỆCH muốn đánh "Đã đối soát" phải ghi rõ đã xử lý/xác nhận thế nào
 * (vd: "FedEx confirm MC thuộc Zone M, đã sửa zone map").
 */
function ReconcileActions({ row }: { row: ReconcileViewRow }) {
  const [note, setNote] = useState(row.note ?? '');
  const [busy, setBusy] = useState(false);
  const isClean = row.diagnosis?.severity === 'match' || row.diagnosis?.severity === 'rounding';
  const needsNote = !isClean;
  const noteMissing = needsNote && note.trim().length === 0;

  async function act(status: 'reconciled' | 'ignored') {
    setBusy(true);
    try {
      await setReconcileStatus({ shipmentId: row.shipmentId, status, note: note.trim() || null, billedTotal: row.billedTotal });
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    setBusy(true);
    try { await clearReconcileStatus(row.shipmentId); } finally { setBusy(false); }
  }

  if (row.status !== 'pending') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <span className={row.status === 'reconciled' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground font-medium'}>
          {row.status === 'reconciled' ? '✓ Đã đối soát' : 'Đã bỏ qua'}
          {row.billedChangedSinceReview ? ' — ⚠ billed đã thay đổi sau khi review' : ''}
        </span>
        {row.note && <span className="text-muted-foreground">Ghi chú: {row.note}</span>}
        <button type="button" disabled={busy} onClick={undo}
          className="ml-auto rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
          Hoàn tác
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {needsNote
          ? 'Đơn đang lệch — ghi rõ cách xử lý / kết quả xác nhận với carrier trước khi chốt'
          : 'Ghi chú (không bắt buộc — đơn đã khớp)'}
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={needsNote
          ? 'VD: FedEx xác nhận MC bill theo Zone M — đã sửa zone mapping / DHL truy thu ER qua bill INV-123…'
          : 'Ghi chú thêm nếu cần…'}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || noteMissing}
          title={noteMissing ? 'Cần ghi rõ cách xử lý vấn đề lệch trước khi đánh dấu đã đối soát' : undefined}
          onClick={() => act('reconciled')}
          className="rounded border border-emerald-500/50 px-3 py-1 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✓ Đã đối soát
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act('ignored')}
          className="rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Bỏ qua
        </button>
        {noteMissing && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            ↑ cần ghi chú xử lý để mở khóa nút &quot;Đã đối soát&quot;
          </span>
        )}
      </div>
    </div>
  );
}
