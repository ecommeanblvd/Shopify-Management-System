'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, TriangleAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { REQUEST_KINDS, REQUEST_STATUSES, type AdminRequestRow } from '@/features/customer-account/requests-shared';
import type { HubRow } from '@/features/customer-account/hubs-shared';
import {
  approveClaim, rejectRequest, markReceived, recordQc, markRefunded,
} from '@/features/customer-account/requests-actions';

interface StoreRef { id: string; name: string; shopDomain: string }

interface Props {
  stores: StoreRef[];
  hubs: HubRow[];
  requests: AdminRequestRow[];
  activeStoreId: string;
  activeKind: string;
  activeStatus: string;
  canManage: boolean;
}

const REASON_LABELS: Record<string, string> = {
  damaged_package: 'Hư hỏng bao bì',
  damaged_product: 'Hư hỏng sản phẩm',
  wrong_item: 'Sai sản phẩm',
  wrong_size: 'Sai size',
  missing_item: 'Thiếu hàng',
  other: 'Khác',
};

const KIND_LABELS: Record<string, string> = { cancel: 'Hủy đơn', claim: 'Khiếu nại' };

export function RequestsTable({
  stores, hubs, requests, activeStoreId, activeKind, activeStatus, canManage,
}: Props) {
  const router = useRouter();
  const disabled = !canManage;
  const activeHubs = hubs.filter((h) => h.active);

  function pushFilter(next: { store?: string; kind?: string; status?: string }) {
    const store = next.store ?? activeStoreId;
    const kind = next.kind ?? activeKind;
    const status = next.status ?? activeStatus;
    const qs = new URLSearchParams();
    if (store) qs.set('store', store);
    if (kind) qs.set('kind', kind);
    if (status) qs.set('status', status);
    const query = qs.toString();
    router.push(`/f/customer-account/requests${query ? `?${query}` : ''}`);
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
          <Label htmlFor="rq-kind" className="text-xs uppercase tracking-wider text-muted-foreground">Loại</Label>
          <select
            id="rq-kind"
            value={activeKind}
            onChange={(e) => pushFilter({ kind: e.target.value })}
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="">— tất cả —</option>
            {REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>
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
            {REQUEST_STATUSES.map((s) => (
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

      <div className="space-y-3">
        {requests.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Chưa có yêu cầu nào.
            </CardContent>
          </Card>
        )}
        {requests.map((r) => (
          <RequestCard key={r.id} row={r} hubs={activeHubs} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ row, hubs, disabled }: { row: AdminRequestRow; hubs: HubRow[]; disabled: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [isPending, startAction] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const [fault, setFault] = useState<'customer' | 'mean'>('customer');
  const [returnHubId, setReturnHubId] = useState(row.returnHubId ?? '');
  const [approveNote, setApproveNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [qcNote, setQcNote] = useState('');

  const showProductionBadge = row.kind === 'cancel' && row.refundPercent === 60 && row.status !== 'refunded';

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setResult(null);
    startAction(async () => {
      const res = await fn();
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{row.storeName}</span>
              <span className="text-muted-foreground">·</span>
              <span className="whitespace-nowrap">{row.orderNumber ?? '—'}</span>
              <Badge variant="outline">{KIND_LABELS[row.kind] ?? row.kind}</Badge>
              <Badge variant="secondary">{row.status}</Badge>
              {showProductionBadge && (
                <Badge variant="destructive" className="gap-1">
                  <TriangleAlert className="size-3" />
                  Báo brand dừng sản xuất
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono">{row.shopifyCustomerId}</div>
            <div className="text-xs text-muted-foreground">
              {row.createdAt.toLocaleString('vi-VN')}
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-lg font-semibold whitespace-nowrap">
              {row.refundAmount} {row.currency}
            </div>
            <div className="text-xs text-muted-foreground">Hoàn {row.refundPercent}%</div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp /> : <ChevronDown />}
              Chi tiết
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border pt-3 space-y-3">
            {row.reasonCodes && row.reasonCodes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {row.reasonCodes.map((code) => (
                  <Badge key={code} variant="outline">{REASON_LABELS[code] ?? code}</Badge>
                ))}
              </div>
            )}
            {row.description && (
              <p className="text-sm text-muted-foreground">{row.description}</p>
            )}
            {row.photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {row.photoUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`Ảnh minh chứng ${i + 1}`}
                    className="max-h-24 rounded-md border border-border cursor-pointer"
                    onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  />
                ))}
              </div>
            )}
            {row.adminNote && (
              <p className="text-xs text-muted-foreground">Ghi chú nội bộ: {row.adminNote}</p>
            )}
            {row.rejectedReason && (
              <p className="text-xs text-destructive">Lý do từ chối: {row.rejectedReason}</p>
            )}

            {/* Action theo trạng thái hiện tại */}
            {(row.status === 'submitted' || row.status === 'under_review') && row.kind === 'claim' && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-4">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Lỗi do</span>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`fault-${row.id}`}
                      value="customer"
                      checked={fault === 'customer'}
                      disabled={disabled}
                      onChange={() => setFault('customer')}
                    />
                    Khách hàng
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`fault-${row.id}`}
                      value="mean"
                      checked={fault === 'mean'}
                      disabled={disabled}
                      onChange={() => setFault('mean')}
                    />
                    MEAN BLVD
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`hub-${row.id}`} className="text-xs uppercase tracking-wider text-muted-foreground">
                    Kho nhận hàng
                  </Label>
                  <select
                    id={`hub-${row.id}`}
                    value={returnHubId}
                    disabled={disabled}
                    onChange={(e) => setReturnHubId(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
                  >
                    <option value="">— chọn kho —</option>
                    {hubs.map((h) => (
                      <option key={h.id} value={h.id}>{h.label}</option>
                    ))}
                  </select>
                </div>
                <Textarea
                  placeholder="Ghi chú nội bộ (tùy chọn)"
                  value={approveNote}
                  disabled={disabled}
                  onChange={(e) => setApproveNote(e.target.value)}
                  className="text-sm"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled || isPending}
                    onClick={() => run(() => approveClaim(row.id, fault, returnHubId, approveNote))}
                  >
                    {isPending && <Loader2 className="animate-spin" />}
                    Duyệt
                  </Button>
                  <Textarea
                    placeholder="Lý do từ chối"
                    value={rejectReason}
                    disabled={disabled}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="text-sm h-8 min-h-8 w-56"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={disabled || isPending}
                    onClick={() => run(() => rejectRequest(row.id, rejectReason))}
                  >
                    Từ chối
                  </Button>
                </div>
              </div>
            )}

            {row.status === 'approved' && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                {(row.returnTrackingNumber || row.returnCarrier) ? (
                  <p className="text-sm">
                    Tracking khách đã nhập: <span className="font-mono">{row.returnTrackingNumber ?? '—'}</span>
                    {row.returnCarrier && ` (${row.returnCarrier})`}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Khách chưa nhập tracking hàng trả.</p>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled || isPending}
                  onClick={() => run(() => markReceived(row.id))}
                >
                  {isPending && <Loader2 className="animate-spin" />}
                  Đã nhận hàng
                </Button>
              </div>
            )}

            {row.status === 'received' && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <Textarea
                  placeholder="Ghi chú QC (bắt buộc khi fail)"
                  value={qcNote}
                  disabled={disabled}
                  onChange={(e) => setQcNote(e.target.value)}
                  className="text-sm"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled || isPending}
                    onClick={() => run(() => recordQc(row.id, true, qcNote))}
                  >
                    {isPending && <Loader2 className="animate-spin" />}
                    QC Pass
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={disabled || isPending}
                    onClick={() => run(() => recordQc(row.id, false, qcNote))}
                  >
                    QC Fail
                  </Button>
                </div>
              </div>
            )}

            {row.status === 'refund_pending' && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-2xl font-semibold">
                  {row.refundAmount} {row.currency}
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled || isPending}
                  onClick={() => run(() => markRefunded(row.id))}
                >
                  {isPending && <Loader2 className="animate-spin" />}
                  Đã refund trong Shopify
                </Button>
              </div>
            )}

            {result && <p className="text-xs text-muted-foreground">{result}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
