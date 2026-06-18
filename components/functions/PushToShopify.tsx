'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { PushSource } from '@/features/carrier-rates/push-plan';
import type { PushStoreResult } from '@/features/carrier-rates/push-orchestrator';
import type { PushCursor, PushStepResult } from '@/features/carrier-rates/push-step';

interface Props {
  stores: { id: string; name: string }[];
  onPushStep: (
    input: { storeId: string; sources: PushSource[]; dryRun: boolean },
    cursor: PushCursor | null,
  ) => Promise<PushStepResult>;
}

interface ProgressState { storeId: string; phase: string; current: number; total: number }

const SOURCES: { key: PushSource; label: string }[] = [
  { key: 'fedex_engine', label: 'FedEx engine' },
  { key: 'dhl_engine', label: 'DHL engine' },
  { key: 'manual_fedex', label: 'Manual FedEx (Standard shipping)' },
  { key: 'manual_dhl', label: 'Manual DHL (Express shipping)' },
];

/** 1 nút đẩy giá ship lên Shopify: chọn NHIỀU store + tick 4 nguồn rate →
 *  Dry-run / Apply → kết quả từng store. Engine → tự đăng ký CarrierService. */
export function PushToShopify({ stores, onPushStep }: Props) {
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [sources, setSources] = useState<Set<PushSource>>(new Set());
  const [preview, setPreview] = useState<PushStoreResult[] | null>(null);
  const [applied, setApplied] = useState<PushStoreResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setSelectedStores(new Set());
    setSources(new Set());
    setPreview(null);
    setApplied(null);
    setBusy(false);
    setProgress(null);
    setErr(null);
  }

  function resetResults() { setPreview(null); setApplied(null); }

  const toggleStore = (id: string) => {
    resetResults();
    setSelectedStores((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSource = (k: PushSource) => {
    resetResults();
    setSources((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? id;

  async function run(dryRun: boolean) {
    setBusy(true); setErr(null); setProgress(null);
    try {
      const sourceList = [...sources];
      const out: PushStoreResult[] = [];
      for (const storeId of [...selectedStores]) {
        const acc: PushStoreResult = { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [] };
        let cursor: PushCursor | null = null;
        do {
          const r: PushStepResult = await onPushStep({ storeId, sources: sourceList, dryRun }, cursor);
          acc.zoneCreated += r.result.zoneCreated;
          acc.rateOps += r.result.rateOps;
          acc.engineZones += r.result.engineZones;
          acc.errors.push(...r.result.errors);
          cursor = r.cursor;
          setProgress({ storeId, phase: r.progress.phase, current: r.progress.current, total: r.progress.total });
          if (r.result.errors.length > 0) break; // stop this store's loop on error
        } while (cursor);
        out.push(acc);
      }
      if (dryRun) { setPreview(out); setApplied(null); } else { setApplied(out); setPreview(null); }
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const disabled = selectedStores.size === 0 || sources.size === 0 || busy;
  const results = applied ?? preview;
  const resultsApplied = applied != null;

  return (
    <Dialog onOpenChange={(o) => { if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/5 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
        ⚡ Đẩy giá ship lên Shopify
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Đẩy giá ship lên Shopify</DialogTitle>
        </DialogHeader>

        {err && <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{err}</div>}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">1. Chọn store (nhiều)</label>
            <div className="flex flex-wrap gap-2">
              {stores.map((s) => (
                <label key={s.id} className={`flex items-center gap-2 rounded border px-3 py-2 text-sm cursor-pointer ${selectedStores.has(s.id) ? 'border-amber-500 bg-amber-500/5' : 'border-border'}`}>
                  <input type="checkbox" checked={selectedStores.has(s.id)} onChange={() => toggleStore(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">2. Chọn rate đẩy</label>
            <div className="space-y-1.5">
              {SOURCES.map((s) => (
                <label key={s.key} className={`flex items-center gap-2 rounded border px-3 py-2 text-sm cursor-pointer ${sources.has(s.key) ? 'border-amber-500 bg-amber-500/5' : 'border-border'}`}>
                  <input type="checkbox" checked={sources.has(s.key)} onChange={() => toggleSource(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Chọn engine → tự đăng ký CarrierService. Tên rate giữ nguyên.</p>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" disabled={disabled} onClick={() => run(true)} className="rounded border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">
              {busy ? 'Đang chạy…' : 'Dry-run (xem trước)'}
            </button>
            <button type="button" disabled={disabled} onClick={() => run(false)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? 'Đang đẩy…' : 'Apply'}
            </button>
          </div>

          {busy && progress && (
            <div className="space-y-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-amber-700 dark:text-amber-400">{storeName(progress.storeId)} — {progress.phase}</span>
                <span className="text-muted-foreground">{progress.current}{progress.total > 0 ? `/${progress.total}` : ''}</span>
              </div>
              {progress.total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }} />
                </div>
              )}
            </div>
          )}

          {results && !busy && (
            <div className={`space-y-1 rounded border p-3 text-sm ${resultsApplied ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'}`}>
              <div className={`font-medium ${resultsApplied ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                {resultsApplied ? '✓ Đã đẩy' : 'Xem trước'}
              </div>
              {results.map((r) => (
                <div key={r.storeId}>
                  • <strong>{storeName(r.storeId)}</strong>: +{r.zoneCreated} zone · {r.rateOps} rate · engine {r.engineZones} zone
                  {r.errors.length > 0 && (
                    <div className="ml-3 text-red-600 dark:text-red-400">
                      {r.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
