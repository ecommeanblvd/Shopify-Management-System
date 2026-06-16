'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { RegisterCarrierServiceResult } from '@/features/carrier-rates/carrier-service-actions';

interface Props {
  stores: { id: string; name: string }[];
  onRegister: (storeId: string) => Promise<RegisterCarrierServiceResult>;
}

/** Bật giá ship carrier-calculated ở checkout: đăng ký Shopify CarrierService trỏ
 *  callback về engine (B1). Yêu cầu store Shopify Plus. Chọn store → đăng ký. */
export function CarrierServiceRegister({ stores, onRegister }: Props) {
  const [storeId, setStoreId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegisterCarrierServiceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() { setStoreId(''); setResult(null); setErr(null); }

  return (
    <Dialog onOpenChange={(o) => { if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/60 bg-sky-500/5 px-4 py-2 text-sm font-medium text-sky-700 dark:text-sky-400 hover:bg-sky-500/10">
        🔌 Bật giá carrier (checkout)
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đăng ký CarrierService (giá tính theo carrier)</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Bật rate carrier-calculated ở checkout: Shopify gọi callback về engine, ta quote
          FedEx + DHL theo cân + địa chỉ thật (gồm ODA / residential / fuel). Khách chọn 1 trong 2.
          Cần store <strong>Shopify Plus</strong>.
        </p>

        {err && <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{err}</div>}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Store</label>
            <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setResult(null); setErr(null); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="">— chọn store —</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <button type="button" disabled={!storeId || busy}
            onClick={async () => { setBusy(true); setErr(null); setResult(null); try { setResult(await onRegister(storeId)); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); } }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? 'Đang đăng ký…' : 'Đăng ký / cập nhật'}
          </button>

          {result && (
            <div className="space-y-1 rounded border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              <div className="font-medium text-emerald-700 dark:text-emerald-400">✓ {result.created ? 'Đã tạo mới' : 'Đã cập nhật'} CarrierService</div>
              <div className="break-all text-xs text-muted-foreground">Callback: {result.callbackUrl}</div>
              <div className="text-xs text-muted-foreground">
                Vào Shopify → Settings → Shipping and delivery → gán carrier <strong>Engine Carrier Rates</strong> vào delivery profile để hiện ở checkout.
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
