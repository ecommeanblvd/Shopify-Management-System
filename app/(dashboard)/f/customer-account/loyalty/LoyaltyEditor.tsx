'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  deleteLoyalty,
  upsertLoyalty,
  type AdminLoyaltyRow,
} from '@/features/customer-account/loyalty-admin';

interface StoreRef { id: string; name: string; shopDomain: string }

interface Props {
  stores: StoreRef[];
  rows: AdminLoyaltyRow[];
  activeStoreId: string;
  canManage: boolean;
}

export function LoyaltyEditor({ stores, rows, activeStoreId, canManage }: Props) {
  const router = useRouter();
  const disabled = !canManage;

  function pushStore(store: string) {
    const qs = new URLSearchParams();
    if (store) qs.set('store', store);
    const query = qs.toString();
    router.push(`/f/customer-account/loyalty${query ? `?${query}` : ''}`);
  }

  // Store dùng cho form thêm mới: ưu tiên filter đang chọn, nếu không lấy store đầu.
  const formStoreId = activeStoreId || stores[0]?.id || '';

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Label htmlFor="ly-store" className="text-xs uppercase tracking-wider text-muted-foreground">Store</Label>
        <select
          id="ly-store"
          value={activeStoreId}
          onChange={(e) => pushStore(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
        >
          <option value="">— tất cả —</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {s.shopDomain}</option>
          ))}
        </select>
      </div>

      {!canManage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Bạn chỉ có quyền xem — cần <code>manage_functions</code> để chỉnh sửa.
        </p>
      )}

      {/* Thêm mới */}
      <AddLoyaltyForm
        stores={stores}
        defaultStoreId={formStoreId}
        disabled={disabled}
      />

      {/* Bảng tier hiện có */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-4 font-medium">Cập nhật</th>
                  <th className="py-2.5 px-4 font-medium">Store</th>
                  <th className="py-2.5 px-4 font-medium">Khách</th>
                  <th className="py-2.5 px-4 font-medium">Tier</th>
                  <th className="py-2.5 px-4 font-medium">Ghi chú</th>
                  <th className="py-2.5 px-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-muted-foreground">
                      Chưa có tier loyalty nào.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <LoyaltyRow key={r.id} row={r} disabled={disabled} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddLoyaltyForm({
  stores,
  defaultStoreId,
  disabled,
}: {
  stores: StoreRef[];
  defaultStoreId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [customerId, setCustomerId] = useState('');
  const [tier, setTier] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<string | null>(null);

  function onSave() {
    setResult(null);
    startSave(async () => {
      const res = await upsertLoyalty(storeId, customerId, tier, note);
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) {
        setCustomerId('');
        setTier('');
        setNote('');
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="text-sm font-medium">Thêm / cập nhật tier</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="ly-add-store" className="text-xs uppercase tracking-wider text-muted-foreground">Store</Label>
            <select
              id="ly-add-store"
              value={storeId}
              disabled={disabled}
              onChange={(e) => setStoreId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.shopDomain}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ly-add-customer" className="text-xs uppercase tracking-wider text-muted-foreground">Customer id</Label>
            <Input
              id="ly-add-customer"
              value={customerId}
              disabled={disabled}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="1234567890"
              className="h-9"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ly-add-tier" className="text-xs uppercase tracking-wider text-muted-foreground">Tier</Label>
            <Input
              id="ly-add-tier"
              value={tier}
              disabled={disabled}
              onChange={(e) => setTier(e.target.value)}
              placeholder="VIP, Gold, ..."
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ly-add-note" className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
            <Input
              id="ly-add-note"
              value={note}
              disabled={disabled}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tuỳ chọn"
              className="h-9"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={onSave} disabled={disabled || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Lưu
          </Button>
          {result && <span className="text-xs text-muted-foreground">{result}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function LoyaltyRow({ row, disabled }: { row: AdminLoyaltyRow; disabled: boolean }) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [tier, setTier] = useState(row.tier);
  const [note, setNote] = useState(row.note ?? '');
  const [result, setResult] = useState<string | null>(null);

  function onSave() {
    setResult(null);
    startSave(async () => {
      const res = await upsertLoyalty(row.storeId, row.shopifyCustomerId, tier, note);
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) router.refresh();
    });
  }

  function onDelete() {
    setResult(null);
    startDelete(async () => {
      const res = await deleteLoyalty(row.id);
      if (res.ok) router.refresh();
      else setResult(`Lỗi: ${res.error ?? 'không rõ'}`);
    });
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
        {row.updatedAt.toLocaleDateString('vi-VN')}
      </td>
      <td className="py-3 px-4">{row.storeName}</td>
      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs">{row.shopifyCustomerId}</td>
      <td className="py-3 px-4">
        <Input
          value={tier}
          disabled={disabled}
          onChange={(e) => setTier(e.target.value)}
          className="h-8 min-w-[8rem]"
          aria-label={`Tier khách ${row.shopifyCustomerId}`}
        />
      </td>
      <td className="py-3 px-4">
        <Input
          value={note}
          disabled={disabled}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ghi chú"
          className="h-8 min-w-[10rem]"
          aria-label={`Ghi chú khách ${row.shopifyCustomerId}`}
        />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={onSave} disabled={disabled || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Lưu
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={disabled || isDeleting}
          >
            {isDeleting && <Loader2 className="animate-spin" />}
            Xoá
          </Button>
          {result && <span className="text-xs text-muted-foreground whitespace-nowrap">{result}</span>}
        </div>
      </td>
    </tr>
  );
}
