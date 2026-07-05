'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { RETURN_STATUSES, updateReturnStatus, type AdminReturnRow } from '@/features/customer-account/returns-admin';

interface StoreRef { id: string; name: string; shopDomain: string }

interface Props {
  stores: StoreRef[];
  returns: AdminReturnRow[];
  activeStoreId: string;
  activeStatus: string;
  canManage: boolean;
}

export function ReturnsTable({ stores, returns, activeStoreId, activeStatus, canManage }: Props) {
  const router = useRouter();
  const disabled = !canManage;

  function pushFilter(next: { store?: string; status?: string }) {
    const store = next.store ?? activeStoreId;
    const status = next.status ?? activeStatus;
    const qs = new URLSearchParams();
    if (store) qs.set('store', store);
    if (status) qs.set('status', status);
    const query = qs.toString();
    router.push(`/f/customer-account/returns${query ? `?${query}` : ''}`);
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="rq-store" className="text-xs uppercase tracking-wider text-muted-foreground">Store</Label>
          <select
            id="rq-store"
            value={activeStoreId}
            onChange={(e) => pushFilter({ store: e.target.value })}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="">— tất cả —</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.shopDomain}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="rq-status" className="text-xs uppercase tracking-wider text-muted-foreground">Trạng thái</Label>
          <select
            id="rq-status"
            value={activeStatus}
            onChange={(e) => pushFilter({ status: e.target.value })}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="">— tất cả —</option>
            {RETURN_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {!canManage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Bạn chỉ có quyền xem — cần <code>manage_functions</code> để duyệt.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-4 font-medium">Ngày</th>
                  <th className="py-2.5 px-4 font-medium">Store</th>
                  <th className="py-2.5 px-4 font-medium">Đơn</th>
                  <th className="py-2.5 px-4 font-medium">Khách</th>
                  <th className="py-2.5 px-4 font-medium">Lý do</th>
                  <th className="py-2.5 px-4 font-medium">Trạng thái</th>
                  <th className="py-2.5 px-4 font-medium">Ghi chú nội bộ</th>
                  <th className="py-2.5 px-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {returns.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 px-4 text-center text-muted-foreground">
                      Chưa có yêu cầu đổi/trả nào.
                    </td>
                  </tr>
                )}
                {returns.map((r) => (
                  <ReturnRow key={r.id} row={r} disabled={disabled} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReturnRow({ row, disabled }: { row: AdminReturnRow; disabled: boolean }) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [status, setStatus] = useState(row.status);
  const [adminNote, setAdminNote] = useState(row.adminNote ?? '');
  const [result, setResult] = useState<string | null>(null);

  function onSave() {
    setResult(null);
    startSave(async () => {
      const res = await updateReturnStatus(row.id, status, adminNote);
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) router.refresh();
    });
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
        {row.createdAt.toLocaleDateString('vi-VN')}
      </td>
      <td className="py-3 px-4">{row.storeName}</td>
      <td className="py-3 px-4 whitespace-nowrap">{row.orderNumber ?? '—'}</td>
      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs">{row.shopifyCustomerId}</td>
      <td className="py-3 px-4 max-w-xs">
        <div>{row.reason}</div>
        {row.note && <div className="text-xs text-muted-foreground mt-0.5">{row.note}</div>}
      </td>
      <td className="py-3 px-4">
        <select
          value={status}
          disabled={disabled}
          onChange={(e) => setStatus(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          aria-label={`Trạng thái đơn ${row.orderNumber ?? row.id}`}
        >
          {RETURN_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </td>
      <td className="py-3 px-4">
        <Input
          value={adminNote}
          disabled={disabled}
          onChange={(e) => setAdminNote(e.target.value)}
          placeholder="Ghi chú"
          className="h-8 min-w-[10rem]"
          aria-label={`Ghi chú đơn ${row.orderNumber ?? row.id}`}
        />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={onSave} disabled={disabled || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Lưu
          </Button>
          {result && <span className="text-xs text-muted-foreground whitespace-nowrap">{result}</span>}
        </div>
      </td>
    </tr>
  );
}
