'use client';

import { useState } from 'react';
import type { ReconcileViewRow } from '@/features/shipments/reconcile-view';
import { fedexImpliedBase } from '@/features/shipments/fedex-quote-compare';
import { setReconcileStatus, clearReconcileStatus, approveCarrierError, disputeWithCarrier } from '@/features/shipments/reconcile-status-actions';
import { CARRIER_ERROR_KINDS, carrierErrorKindLabel, carrierErrorKindRemediation } from '@/features/shipments/carrier-error-kinds';
import { suggestCauseKind, needsCarrierClaim, isApprovableMatch } from '@/features/shipments/carrier-error-flow';

const fmtVnd = (n: number | null): string =>
  n === null
    ? '—'
    : (n < 0 ? '-' : '') +
      new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));

const CAUSE_LABEL: Record<string, string> = {
  KHOP: '', SAI_CAN: 'sai cân', THIEU_CAU_HINH_REMOTE: 'thiếu cấu hình vùng xa',
  REMOTE_KHONG_KHOP: 'remote không khớp', LECH_RATE_CARD: 'lệch rate card',
  LECH_CHIET_KHAU: 'lệch chiết khấu', LECH_FUEL: 'lệch % fuel', LECH_FUEL_BASE: 'fuel base khác',
  SAI_ZONE: 'lệch zone', PHAI_SINH_ZONE: 'khớp theo zone bill',
  PHAI_SINH: 'phái sinh', KHONG_KHOP: 'không khớp', LAM_TRON: 'làm tròn', PHI_TUY_CHON: 'phí opt-in',
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

type CompKey = 'base' | 'fuel' | 'remote' | 'demand' | 'signature' | 'residential' | 'addressCorrection' | 'gogreen' | 'vat' | 'elevatedRisk';

interface ComponentLine {
  label: string;
  billed: number | null;
  engine: number | null;
  fedex: number | null;
  /** Diagnosis component key this display line maps to. */
  compKey: CompKey;
  /** Optional annotations rendered after the amounts (e.g. fuel %). */
  billedSuffix?: string;
  engineSuffix?: string;
  fedexSuffix?: string;
}

/** Giá FedEx (Rate API) cho từng dòng phụ phí; null khi chưa quote / không áp dụng. */
function fedexLine(row: ReconcileViewRow, key: CompKey): number | null {
  const q = row.fedexQuote;
  if (!q) return null;
  switch (key) {
    case 'base': return fedexImpliedBase(q);
    case 'fuel': return q.fuel;
    case 'remote': return q.remote;
    case 'demand': return q.demand;
    case 'signature': return q.signature; // ký nhận thật (API thường 0 — special service)
    case 'residential': return q.residential; // giao địa chỉ nhà dân
    case 'vat': return q.vat;
    case 'elevatedRisk': return q.countryFixed; // dòng "Phí cố định nước (nhập US…)" = ANCILLARY_FEE
    default: return null; // gogreen: FedEx không có dòng tương ứng
  }
}

/** Nhãn phân loại địa chỉ (FedEx Address Validation) cho dòng residential. */
function residentialClassLabel(cls: string | null): string | undefined {
  switch (cls) {
    case 'RESIDENTIAL': return '🏠 nhà dân ✓';
    case 'BUSINESS': return '⚠ doanh nghiệp — đòi NCC';
    case 'MIXED': return 'hỗn hợp';
    case 'UNKNOWN': return 'chưa xác minh';
    default: return undefined;
  }
}

/** Sum engine sub-charges that share a display line, preserving null when the
 *  engine produced no quote (every part null). */
function sumEngine(...parts: Array<number | null>): number | null {
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((a, p) => a + (p ?? 0), 0);
}

function lines(row: ReconcileViewRow): ComponentLine[] {
  const fx = (k: CompKey) => fedexLine(row, k);
  return [
    { label: 'Cước gốc (sau giảm giá)', billed: row.billedBaseNet, engine: row.engineBaseNet, fedex: fx('base'), compKey: 'base' },
    {
      label: 'Phụ phí xăng dầu (fuel)', billed: row.billedFuel, engine: row.engineFuel, fedex: fx('fuel'), compKey: 'fuel',
      billedSuffix: row.billedFuelPercent !== null ? `${row.billedFuelPercent}%` : undefined,
      engineSuffix: row.engineFuelPercent !== null ? `${row.engineFuelPercent}%` : undefined,
      fedexSuffix: row.fedexQuote?.fuelPercent != null ? `${row.fedexQuote.fuelPercent}%` : undefined,
    },
    { label: 'Vùng xa (remote)', billed: row.billedRemote, engine: row.engineRemote, fedex: fx('remote'), compKey: 'remote' },
    { label: 'Phụ phí nhu cầu (demand)', billed: row.billedDemand, engine: row.engineDemand, fedex: fx('demand'), compKey: 'demand' },
    // signature: engine books DHL/FedEx Direct Signature dưới addon_fixed.
    { label: 'Ký nhận (signature)', billed: row.billedSignature, engine: row.engineAddons, fedex: fx('signature'), compKey: 'signature' },
    // residential: phí giao địa chỉ nhà dân (FedEx) — dòng RIÊNG, pass-through.
    // billedSuffix = phân loại địa chỉ (FedEx Address Validation): xác minh phí
    // đúng/sai (BUSINESS ⇒ thu sai ⇒ đòi NCC).
    {
      label: 'Giao địa chỉ nhà (residential)', billed: row.billedResidential, engine: row.engineResidential,
      fedex: fx('residential'), compKey: 'residential', billedSuffix: residentialClassLabel(row.residentialClass),
    },
    // addressCorrection: phí FedEx sửa địa chỉ sai — pass-through (engine 0).
    // Chỉ hiện dòng khi có bill (đa số đơn = 0). Gắn với địa chỉ không giao được.
    ...(Number(row.billedAddressCorrection ?? 0) > 0 ? [{
      label: 'Sửa địa chỉ (address correction)', billed: row.billedAddressCorrection, engine: null,
      fedex: null, compKey: 'addressCorrection' as const,
    }] : []),
    // gogreen: engine books DHL GoGreen under per_step_fixed.
    { label: 'GoGreen', billed: row.billedGogreen, engine: row.enginePerStep, fedex: fx('gogreen'), compKey: 'gogreen' },
    { label: 'VAT', billed: row.billedVat, engine: row.engineVat, fedex: fx('vat'), compKey: 'vat' },
    // country_fixed counterpart: DHL Elevated Risk / FedEx US import handling.
    {
      label: row.carrierKey === 'fedex' ? 'Phí cố định nước (nhập US…)' : 'Phụ phí rủi ro (ER)',
      billed: sumEngine(row.billedElevatedRisk, row.billedImportHandling),
      engine: row.engineCountryFixed,
      fedex: fx('elevatedRisk'),
      compKey: 'elevatedRisk',
    },
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
      {row.fedexQuote && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            Đối soát 3 bên · API NCC (ước tính) · {row.fedexQuote.service.replace('FEDEX_INTERNATIONAL_', 'Int’l ')}
            {row.fedexQuote.rateZone ? ` · zone ${row.fedexQuote.rateZone}` : ''}
          </span>
          {row.fedexCompare && (
            <span className={`rounded px-2 py-0.5 font-medium ${row.fedexCompare.overcharged ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
              {row.fedexCompare.verdict}
            </span>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            <th className="text-left py-1">Khoản phí</th>
            <th className="text-right py-1">Hệ thống</th>
            <th className="text-right py-1" title="API hãng vận chuyển (FedEx/DHL…) tính lại theo bảng giá hợp đồng — ước tính đối chiếu, KHÔNG phải giá thật đã chốt">API NCC (ước tính)</th>
            <th className="text-right py-1" title="Giá THẬT hãng tính trên hoá đơn cho tracking number này">Billed (thật)</th>
            <th className="text-right py-1">Lệch ({(row.billedTotal ?? 0) > 0 ? 'Bill' : 'API'}−HT)</th>
            <th className="text-right py-1">Chẩn đoán</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {lines(row).map((l) => {
            // Lệch = Hệ thống vs BILLED (giá thật) khi đã có hoá đơn — API chỉ là
            // ước tính tham khảo. Chưa có billed (đơn mới) → so với API.
            const ref = (row.billedTotal ?? 0) > 0 ? l.billed : l.fedex;
            const delta = ref === null && l.engine === null
              ? null
              : (ref ?? 0) - (l.engine ?? 0);
            const comp = row.diagnosis?.components.find((x) => x.key === l.compKey);
            const causeLabel = comp && comp.cause !== 'KHOP' ? CAUSE_LABEL[comp.cause] : '';
            return (
              <tr key={l.label} className="border-t border-border">
                <td className="py-1 font-sans">{l.label}</td>
                <td className="py-1 text-right">
                  {fmtVnd(l.engine)}
                  {l.engineSuffix && <span className="ml-1 text-[11px] text-muted-foreground">({l.engineSuffix})</span>}
                </td>
                <td className="py-1 text-right">
                  {l.fedex === null ? <span className="text-muted-foreground">—</span> : fmtVnd(l.fedex)}
                  {l.fedexSuffix && <span className="ml-1 text-[11px] text-muted-foreground">({l.fedexSuffix})</span>}
                </td>
                <td className="py-1 text-right text-muted-foreground">
                  {fmtVnd(l.billed)}
                  {l.billedSuffix && <span className="ml-1 text-[11px]">({l.billedSuffix})</span>}
                </td>
                <td className={`py-1 text-right ${delta && Math.abs(delta) > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  {fmtVnd(delta)}
                </td>
                <td className="py-1 text-right font-sans text-[11px] text-muted-foreground">{causeLabel}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-1 font-sans">Tổng</td>
            <td className="py-1 text-right">{fmtVnd(row.engineTotal)}</td>
            <td className="py-1 text-right">{fmtVnd(row.fedexQuote?.totalNetCharge ?? null)}</td>
            <td className="py-1 text-right text-muted-foreground">{fmtVnd(row.billedTotal)}</td>
            <td className="py-1 text-right">
              {fmtVnd((row.fedexQuote?.totalNetCharge ?? row.billedTotal) - row.engineTotal)}
            </td>
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
  const [kind, setKind] = useState(() => suggestCauseKind(row.diagnosis));
  const [busy, setBusy] = useState(false);
  const isClean = row.diagnosis?.severity === 'match' || row.diagnosis?.severity === 'rounding';
  const noteEmpty = note.trim().length === 0;

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
  async function approve() {
    if (!note.trim() || !kind) return;
    setBusy(true);
    try {
      await approveCarrierError({
        shipmentId: row.shipmentId, kind, note: note.trim(),
        billedTotal: row.billedTotal, deltaVnd: row.deltaVnd ?? 0,
      });
    } finally { setBusy(false); }
  }
  async function dispute() {
    if (!note.trim() || !kind) return;
    setBusy(true);
    try {
      await disputeWithCarrier({ shipmentId: row.shipmentId, kind, note: note.trim(), billedTotal: row.billedTotal, deltaVnd: row.deltaVnd ?? 0 });
    } finally { setBusy(false); }
  }
  async function approveDispute() {
    setBusy(true);
    try {
      await approveCarrierError({ shipmentId: row.shipmentId, kind: row.carrierErrorKind ?? kind, note: row.note ?? note.trim(), billedTotal: row.billedTotal, deltaVnd: row.deltaVndAtReview ?? row.deltaVnd ?? 0 });
    } finally { setBusy(false); }
  }

  if (row.status === 'disputing') {
    const ready = isApprovableMatch(row.diagnosis?.severity);
    return (
      <div className="mt-4 space-y-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
        <div className="font-medium text-sky-600 dark:text-sky-400">
          ⏳ Đang đòi NCC — {carrierErrorKindLabel(row.carrierErrorKind ?? '')} · lệch gốc {fmtVnd(row.deltaVndAtReview)}đ
        </div>
        {row.note && <div className="text-muted-foreground">Ghi chú: {row.note}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !ready}
            title={!ready ? 'Chờ NCC sửa bill cho khớp mới duyệt được' : undefined}
            onClick={approveDispute}
            className="rounded border border-emerald-500/50 px-3 py-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40">
            ✓ Duyệt chênh lệch
          </button>
          {!ready && <span className="text-xs text-muted-foreground">Chờ NCC sửa bill cho khớp…</span>}
          <button type="button" disabled={busy} onClick={undo}
            className="ml-auto rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">Hoàn tác</button>
        </div>
      </div>
    );
  }

  if (row.status !== 'pending') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <span className={
          row.status === 'reconciled' ? 'text-emerald-600 dark:text-emerald-400 font-medium'
          : row.status === 'carrier_error' ? 'text-amber-600 dark:text-amber-400 font-medium'
          : 'text-muted-foreground font-medium'
        }>
          {row.status === 'reconciled' ? '✓ Đã đối soát'
            : row.status === 'carrier_error' ? `✓ Đã duyệt — lỗi carrier (${carrierErrorKindLabel(row.carrierErrorKind ?? '')})`
            : 'Đã bỏ qua'}
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

  // Đơn KHỚP: gọn tối đa — 1 nút xác nhận, "Bỏ qua" mờ. Không cần lý do.
  if (isClean) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Đơn khớp — không cần xử lý.</span>
        <button type="button" disabled={busy} onClick={() => act('reconciled')}
          className="ml-auto rounded border border-emerald-500/50 px-3 py-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40">
          ✓ Xác nhận khớp
        </button>
        <button type="button" disabled={busy} onClick={() => act('ignored')}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">
          Bỏ qua
        </button>
      </div>
    );
  }

  // Đơn LỆCH: ô lý do + chọn loại lỗi cụ thể + hành động theo hướng lệch.
  return (
    <div className="mt-4 space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Đơn đang lệch — chọn loại lỗi cụ thể + ghi lý do
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="VD: FedEx bill MC theo Zone M nhưng card 2026 là Zone H — đã gửi NCC yêu cầu chỉnh…"
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
      />
      <select value={kind} onChange={(e) => setKind(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm">
        <option value="">— chọn loại lỗi cụ thể —</option>
        {CARRIER_ERROR_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      {kind && <p className="text-xs text-muted-foreground">💡 {carrierErrorKindRemediation(kind)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {needsCarrierClaim(row.deltaVnd) ? (
          <button type="button" disabled={busy || noteEmpty || !kind}
            title={!kind ? 'Chọn loại lỗi' : noteEmpty ? 'Cần ghi lý do' : undefined}
            onClick={dispute}
            className="rounded border border-amber-500/50 px-3 py-1 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40">
            Đối soát lại với NCC →
          </button>
        ) : (
          <button type="button" disabled={busy || noteEmpty || !kind}
            title={!kind ? 'Chọn loại lỗi' : noteEmpty ? 'Cần ghi lý do' : undefined}
            onClick={approve}
            className="rounded border border-emerald-500/50 px-3 py-1 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40">
            ✓ Duyệt chênh lệch
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => act('ignored')}
          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">Bỏ qua</button>
        {needsCarrierClaim(row.deltaVnd) && (
          <span className="w-full text-xs text-muted-foreground">NCC thu vượt {fmtVnd(row.deltaVnd)}đ — đòi lại; duyệt được khi bill mới khớp.</span>
        )}
      </div>
    </div>
  );
}
