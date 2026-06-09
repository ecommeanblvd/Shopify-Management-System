'use client';

import { useState, useTransition } from 'react';
import { createPack, markCheckPacked, shipPack } from '@/features/packing/actions';

type PickedLine = { id: string; sku: string | null; qty: number; productTitle: string | null };
type PackLine = { id: string; sku: string | null; qty: number; status: string; productTitle: string | null };
type Pack = {
  id: string; code: string | null; carrierKey: string | null;
  trackingNumber: string | null; checkPackedAt: string | Date | null;
  actualWeightKg: string | null; lines: PackLine[];
};

interface Props {
  orderId: string;
  picked: PickedLine[];
  packs: Pack[];
  canManage: boolean;
  canCheckPacked: boolean;
}

export function PackPanel({ orderId, picked, packs, canManage, canCheckPacked }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [carrier, setCarrier] = useState('');
  const [weight, setWeight] = useState('');
  const [packaging, setPackaging] = useState('');
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const chosen = picked.filter((l) => selected[l.id]).map((l) => l.id);

  const handleCreate = () => startTransition(async () => {
    await createPack({
      orderId, lineIds: chosen,
      carrierKey: carrier || null,
      packagingType: packaging === 'bag' || packaging === 'box' ? packaging : null,
      weightKg: weight ? Number(weight) : null,
    });
    setSelected({}); setCarrier(''); setWeight(''); setPackaging('');
  });

  return (
    <div className="space-y-6">
      {canManage && picked.length > 0 && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Đóng kiện ({picked.length} dòng đã lấy)</h3>
          <ul className="space-y-1">
            {picked.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!selected[l.id]}
                  onChange={(e) => setSelected((s) => ({ ...s, [l.id]: e.target.checked }))} />
                <span className="font-mono text-xs">{l.sku ?? '—'}</span>
                <span className="text-muted-foreground">{l.productTitle ?? ''} ×{l.qty}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier (vd fedex)"
              className="border border-input bg-input/30 rounded-md px-2 py-1 text-sm" />
            <select value={packaging} onChange={(e) => setPackaging(e.target.value)}
              className="border border-input bg-input/30 rounded-md px-2 py-1 text-sm">
              <option value="">Loại đóng gói</option>
              <option value="bag">Bag</option>
              <option value="box">Box</option>
            </select>
            <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Cân nặng (kg)" inputMode="decimal"
              className="border border-input bg-input/30 rounded-md px-2 py-1 text-sm w-32" />
            <button disabled={isPending || chosen.length === 0} onClick={handleCreate}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
              Tạo kiện ({chosen.length})
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Kiện ({packs.length})</h3>
        {packs.map((p) => {
          const checked = p.checkPackedAt != null;
          const shipped = p.trackingNumber != null;
          return (
            <div key={p.id} className="rounded-lg border border-border p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-sm font-medium">{p.code ?? '—'}</div>
                <div className="flex items-center gap-2 text-xs">
                  {p.carrierKey && <span className="rounded bg-muted px-2 py-0.5">{p.carrierKey}</span>}
                  {p.actualWeightKg && <span className="text-muted-foreground">{p.actualWeightKg} kg</span>}
                  <span className={`rounded px-2 py-0.5 ${checked ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                    {checked ? 'Đã check-packed' : 'Chưa check'}
                  </span>
                  {shipped && <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5">Đã ship</span>}
                </div>
              </div>
              <ul className="text-sm text-muted-foreground">
                {p.lines.map((l) => (
                  <li key={l.id} className="font-mono text-xs">{l.sku ?? '—'} ×{l.qty} · {l.status}</li>
                ))}
              </ul>
              {canManage && !shipped && (
                <div className="flex flex-wrap items-center gap-2">
                  {canCheckPacked && !checked && (
                    <button disabled={isPending} onClick={() => startTransition(async () => { await markCheckPacked(p.id); })}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                      Check packed
                    </button>
                  )}
                  <input value={tracking[p.id] ?? ''} onChange={(e) => setTracking((t) => ({ ...t, [p.id]: e.target.value }))}
                    placeholder="Tracking number" disabled={!checked}
                    className="border border-input bg-input/30 rounded-md px-2 py-1 text-xs disabled:opacity-50" />
                  <button disabled={isPending || !checked || !(tracking[p.id] ?? '').trim()}
                    onClick={() => startTransition(async () => { await shipPack(p.id, tracking[p.id] ?? ''); })}
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    Ship
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {packs.length === 0 && <p className="text-sm text-muted-foreground">Chưa có kiện nào.</p>}
      </div>
    </div>
  );
}
