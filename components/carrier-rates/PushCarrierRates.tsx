'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { PushCarrierInput, PushCarrierResult } from '@/features/carrier-rates/push-engine/actions';

interface Props {
  stores: { id: string; name: string }[];
  onPush: (input: PushCarrierInput) => Promise<PushCarrierResult>;
}

const CARRIERS = [{ key: 'fedex', label: 'FedEx' }, { key: 'dhl', label: 'DHL' }];

/** Đẩy giá carrier engine (real-time) lên 1 store qua API — né bug picker. Chọn
 *  store + carrier hiện ở checkout + tuỳ chọn Standard backup. Dry-run trước. */
export function PushCarrierRates({ stores, onPush }: Props) {
  const [storeId, setStoreId] = useState('');
  const [carriers, setCarriers] = useState<Set<string>>(new Set(['fedex', 'dhl']));
  const [withBackup, setWithBackup] = useState(true);
  const [preview, setPreview] = useState<PushCarrierResult | null>(null);
  const [applied, setApplied] = useState<PushCarrierResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() { setStoreId(''); setCarriers(new Set(['fedex', 'dhl'])); setWithBackup(true); setPreview(null); setApplied(null); setConfirm(false); setErr(null); }
  const toggleCarrier = (k: string) => { setPreview(null); setApplied(null); setConfirm(false); setCarriers((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); };

  async function run(dryRun: boolean) {
    setBusy(true); setErr(null);
    try {
      const r = await onPush({ storeId, carriers: [...carriers], withBackup, dryRun });
      if (dryRun) { setPreview(r); setApplied(null); } else { setApplied(r); setConfirm(false); }
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog onOpenChange={(o) => { if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/60 bg-violet-500/5 px-4 py-2 text-sm font-medium text-violet-700 dark:text-violet-400 hover:bg-violet-500/10">
        🚀 Push Carrier Rates (engine)
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Đẩy giá carrier engine lên store</DialogTitle></DialogHeader>

        <p className="text-xs text-muted-foreground">
          Gắn carrier-calculated (giá engine real-time) vào delivery profile qua API — né bug picker.
          Bỏ qua zone VN (free). Tuỳ chọn kèm “Standard shipping” flat backup.
        </p>

        {err && <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{err}</div>}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">1. Store</label>
            <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setPreview(null); setApplied(null); }} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">— chọn store —</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">2. Carrier hiện ở checkout</label>
            <div className="flex gap-2">
              {CARRIERS.map((c) => (
                <label key={c.key} className={`flex items-center gap-2 rounded border px-3 py-2 text-sm cursor-pointer ${carriers.has(c.key) ? 'border-violet-500 bg-violet-500/5' : 'border-border'}`}>
                  <input type="checkbox" checked={carriers.has(c.key)} onChange={() => toggleCarrier(c.key)} />{c.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Bỏ tick = pause carrier đó (không hiện ở checkout).</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withBackup} onChange={(e) => { setWithBackup(e.target.checked); setPreview(null); setApplied(null); }} />
            Kèm “Standard shipping” flat backup (FedEx)
          </label>

          {storeId && carriers.size > 0 && !applied && (
            <button type="button" disabled={busy} onClick={() => run(true)} className="rounded border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">
              {busy ? 'Đang chạy…' : 'Dry-run (xem trước)'}
            </button>
          )}

          {preview && !applied && (
            <div className="space-y-2 rounded border border-border p-3 text-sm">
              <div>Sẽ đẩy <b>{[...carriers].join(' + ')}</b> lên <b>{preview.zonesTargeted}</b> zone quốc tế (bỏ qua {preview.zonesSkippedVn} zone VN). Standard backup: <b>{preview.backupZones}</b> zone.</div>
              {!confirm ? (
                <button type="button" onClick={() => setConfirm(true)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Apply lên {preview.storeName}</button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-amber-700 dark:text-amber-400">⚠ Ghi thật + xoá rate cũ. Xác nhận?</span>
                  <button type="button" disabled={busy} onClick={() => run(false)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? 'Đang apply…' : 'Xác nhận'}</button>
                  <button type="button" onClick={() => setConfirm(false)} className="rounded border px-3 py-2 text-sm">Huỷ</button>
                </div>
              )}
            </div>
          )}

          {applied && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              ✓ Đã đẩy <b>{applied.carriers.join(' + ')}</b> lên {applied.storeName}: {applied.zonesTargeted} zone (backup {applied.backupZones}). Test checkout để xác nhận.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
