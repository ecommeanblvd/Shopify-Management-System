'use client';

import { useState, useTransition } from 'react';
import { upsertWarehouseItem, adjustStock } from '@/features/fulfillment/warehouse-actions';
import type { WarehouseItemInput } from '@/features/fulfillment/warehouse-actions';

interface WarehouseItem {
  id: string;
  sku: string;
  productTitle: string | null;
  variantTitle: string | null;
  qtyOnHand: number;
  qtyReserved: number;
  shelf: string | null;
  floor: string | null;
  bin: string | null;
  note: string | null;
}

interface Props {
  items: WarehouseItem[];
  canManage: boolean;
}

const fmtQty = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

const EMPTY_FORM: WarehouseItemInput = {
  sku: '',
  productTitle: '',
  variantTitle: '',
  qtyOnHand: 0,
  shelf: '',
  floor: '',
  bin: '',
  note: '',
};

export function WarehouseTable({ items, canManage }: Props) {
  const [form, setForm] = useState<WarehouseItemInput>(EMPTY_FORM);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [adjustPending, setAdjustPending] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function loadRow(item: WarehouseItem) {
    setEditingSku(item.sku);
    setForm({
      sku: item.sku,
      productTitle: item.productTitle ?? '',
      variantTitle: item.variantTitle ?? '',
      qtyOnHand: item.qtyOnHand,
      shelf: item.shelf ?? '',
      floor: item.floor ?? '',
      bin: item.bin ?? '',
      note: item.note ?? '',
    });
    setFormError(null);
  }

  function resetForm() {
    setEditingSku(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function handleSave() {
    if (!form.sku.trim()) {
      setFormError('SKU không được để trống.');
      return;
    }
    setFormError(null);
    startTransition(async () => {
      await upsertWarehouseItem({
        ...form,
        productTitle: form.productTitle || null,
        variantTitle: form.variantTitle || null,
        shelf: form.shelf || null,
        floor: form.floor || null,
        bin: form.bin || null,
        note: form.note || null,
        qtyOnHand: Number(form.qtyOnHand),
      });
      resetForm();
    });
  }

  function handleAdjust(sku: string, delta: number) {
    setAdjustPending(sku);
    startTransition(async () => {
      await adjustStock({ sku, warehouseCode: 'HN', delta, note: 'Điều chỉnh nhanh từ bảng kho (legacy UI)' });
      setAdjustPending(null);
    });
  }

  const colSpan = canManage ? 10 : 9;

  return (
    <div className="space-y-4">
      {/* Add / Edit form */}
      {canManage && (
        <div className="rounded-lg border border-border bg-background p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editingSku ? `Sửa SKU: ${editingSku}` : 'Thêm / Cập nhật SKU'}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">SKU *</label>
              <input
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                disabled={isPending || !!editingSku}
                placeholder="VD: SKU-001"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tên sản phẩm</label>
              <input
                value={form.productTitle ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, productTitle: e.target.value }))}
                disabled={isPending}
                placeholder="Tên SP"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Variant</label>
              <input
                value={form.variantTitle ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, variantTitle: e.target.value }))}
                disabled={isPending}
                placeholder="Màu / Size"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Số lượng tồn</label>
              <input
                type="number"
                value={form.qtyOnHand}
                onChange={(e) => setForm((f) => ({ ...f, qtyOnHand: Number(e.target.value) }))}
                disabled={isPending}
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Kệ</label>
              <input
                value={form.shelf ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, shelf: e.target.value }))}
                disabled={isPending}
                placeholder="A / B"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tầng</label>
              <input
                value={form.floor ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                disabled={isPending}
                placeholder="1 / 2"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Bin</label>
              <input
                value={form.bin ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, bin: e.target.value }))}
                disabled={isPending}
                placeholder="01 / 02"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ghi chú</label>
              <input
                value={form.note ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                disabled={isPending}
                placeholder="Ghi chú"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
          </div>
          {formError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{formError}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
            >
              {isPending ? 'Đang lưu…' : 'Lưu'}
            </button>
            {editingSku && (
              <button
                onClick={resetForm}
                disabled={isPending}
                className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
              >
                Huỷ
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">Tên</th>
              <th className="px-3 py-2 text-right">Khả dụng</th>
              <th className="px-3 py-2 text-right">Tồn</th>
              <th className="px-3 py-2 text-right">Giữ</th>
              <th className="px-3 py-2 text-left">Kệ</th>
              <th className="px-3 py-2 text-left">Tầng</th>
              <th className="px-3 py-2 text-left">Bin</th>
              {canManage && <th className="px-3 py-2 text-left">Điều chỉnh</th>}
              {canManage && <th className="px-3 py-2 text-left">Hành động</th>}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-3 py-6 text-center font-sans text-muted-foreground"
                >
                  Chưa có SKU nào trong kho.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const available = item.qtyOnHand - item.qtyReserved;
                const isAdjusting = adjustPending === item.sku;
                const name = [item.productTitle, item.variantTitle]
                  .filter(Boolean)
                  .join(' — ');
                return (
                  <tr
                    key={item.id}
                    className="border-t border-border hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 font-sans">{item.sku}</td>
                    <td className="px-3 py-2 font-sans">{name || '—'}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        available <= 0
                          ? 'text-red-600 dark:text-red-400'
                          : available <= 5
                          ? 'text-amber-600 dark:text-amber-400'
                          : ''
                      }`}
                    >
                      {fmtQty(available)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtQty(item.qtyOnHand)}</td>
                    <td className="px-3 py-2 text-right">{fmtQty(item.qtyReserved)}</td>
                    <td className="px-3 py-2 font-sans">{item.shelf ?? '—'}</td>
                    <td className="px-3 py-2 font-sans">{item.floor ?? '—'}</td>
                    <td className="px-3 py-2 font-sans">{item.bin ?? '—'}</td>
                    {canManage && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            disabled={isPending || isAdjusting}
                            onClick={() => handleAdjust(item.sku, -1)}
                            className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                          >
                            &minus;1
                          </button>
                          <button
                            disabled={isPending || isAdjusting}
                            onClick={() => handleAdjust(item.sku, 1)}
                            className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                          >
                            +1
                          </button>
                        </div>
                      </td>
                    )}
                    {canManage && (
                      <td className="px-3 py-2">
                        <button
                          disabled={isPending}
                          onClick={() => loadRow(item)}
                          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                        >
                          Sửa
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
