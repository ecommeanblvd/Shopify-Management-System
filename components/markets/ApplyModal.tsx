'use client';

import { useState } from 'react';
import type { MarketOps } from '@/features/markets/diff';

interface Store {
  id: string;
  name: string;
  shopDomain: string;
}

interface Props {
  stores: Store[];
  onPreview: (storeId: string) => Promise<{ ops: MarketOps }>;
  onApply: (storeId: string) => Promise<{ errors: Array<{ step: string; error: string }> }>;
}

export function ApplyModal({ stores, onPreview, onApply }: Props) {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [ops, setOps] = useState<MarketOps | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const store = stores.find((s) => s.id === storeId);

  return (
    <div className="space-y-6 max-w-3xl">
      <section>
        <h2 className="text-lg font-medium mb-3">1. Select store</h2>
        <select
          value={storeId ?? ''}
          onChange={(e) => { setStoreId(e.target.value || null); setOps(null); setResult(null); }}
          className="rounded border px-3 py-2 w-full"
        >
          <option value="">— pick a store —</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.shopDomain})</option>
          ))}
        </select>
      </section>

      {storeId && (
        <section>
          <h2 className="text-lg font-medium mb-3">2. Dry-run preview</h2>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              try {
                const r = await onPreview(storeId);
                setOps(r.ops);
              } catch (e) {
                setResult(`Preview failed: ${e}`);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {busy ? 'Running…' : 'Run dry-run'}
          </button>
          {ops && (
            <div className="mt-4 space-y-2 text-sm">
              <DiffSummary ops={ops} />
            </div>
          )}
        </section>
      )}

      {ops && store && (
        <section>
          <h2 className="text-lg font-medium mb-3">3. Confirm and apply</h2>
          <label className="block mb-3 text-sm">
            <span>Type <code className="bg-muted px-1">{store.shopDomain}</code> to confirm</span>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-2"
            />
          </label>
          <button
            type="button"
            disabled={busy || confirm !== store.shopDomain}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await onApply(storeId!);
                setResult(r.errors.length === 0
                  ? `Applied successfully (${countOps(ops)} ops).`
                  : `Applied with ${r.errors.length} error(s): ${r.errors.map((e) => e.step).join(', ')}`);
              } catch (e) {
                setResult(`Apply failed: ${e}`);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Applying…' : `Apply ${countOps(ops)} changes`}
          </button>
        </section>
      )}

      {result && (
        <div className="rounded border p-4 text-sm whitespace-pre-wrap">{result}</div>
      )}
    </div>
  );
}

function countOps(ops: MarketOps): number {
  return ops.marketsToCreate.length + ops.marketsToUpdate.length + ops.marketsToDelete.length
    + ops.regionsToAdd.length + ops.regionsToRemove.length
    + ops.currencyUpdates.length + ops.languageUpdates.length
    + ops.priceListsToCreate.length + ops.priceListsToUpdate.length + ops.priceListsToDelete.length;
}

function DiffSummary({ ops }: { ops: MarketOps }) {
  const rows: Array<[string, number, string]> = [
    ['Markets to create', ops.marketsToCreate.length, 'emerald'],
    ['Markets to update', ops.marketsToUpdate.length, 'amber'],
    ['Markets to delete', ops.marketsToDelete.length, 'red'],
    ['Regions to add', ops.regionsToAdd.length, 'emerald'],
    ['Regions to remove', ops.regionsToRemove.length, 'red'],
    ['Currency updates', ops.currencyUpdates.length, 'amber'],
    ['Language updates', ops.languageUpdates.length, 'amber'],
    ['Price lists to create', ops.priceListsToCreate.length, 'emerald'],
    ['Price lists to update', ops.priceListsToUpdate.length, 'amber'],
    ['Price lists to delete', ops.priceListsToDelete.length, 'red'],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(([label, n, color]) => (
        <div
          key={label}
          className={`rounded border px-3 py-2 ${n > 0 ? 'border-' + color + '-500' : ''}`}
        >
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="text-lg font-medium">{n}</div>
        </div>
      ))}
    </div>
  );
}
