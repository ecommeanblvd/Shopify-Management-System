'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  upsertWarehouseItem, adjustStock, transferStock, getMovements, getItems,
} from '@/features/fulfillment/warehouse-actions';
import type { WarehouseItemInput } from '@/features/fulfillment/warehouse-actions';
import type { InventoryRow, MovementRow, WarehouseItemRow } from '@/features/warehouse/queries';

const fmtQty = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const fmtDelta = (n: number) =>
  n > 0 ? `+${new Intl.NumberFormat('vi-VN').format(n)}` : new Intl.NumberFormat('vi-VN').format(n);

/** Thứ tự kho mặc định khi không suy ra được từ dữ liệu. */
const WAREHOUSE_ORDER = ['GVM', 'AP', 'DM'] as const;
type WarehouseCode = (typeof WAREHOUSE_ORDER)[number];
type Tab = string; // mã kho hoặc 'ALL'

/** Nhãn tiếng Việt cho stockStatus của từng món. */
const STOCK_STATUS_LABEL: Record<string, string> = {
  in_stock: 'Trong kho',
  staging: 'Khu chờ',
  allocated: 'Đã giữ',
  picked: 'Đã pick',
  shipped: 'Đã đi',
  qc_failed: 'QC lỗi',
  returned_to_vendor: 'Trả NCC',
  pending: 'Chờ QC',
};

const STOCK_STATUS_CLASS: Record<string, string> = {
  in_stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  staging: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  allocated: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  picked: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  shipped: 'bg-muted text-muted-foreground',
  qc_failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  returned_to_vendor: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  pending: 'bg-muted text-muted-foreground',
};

const REASON_LABEL: Record<string, string> = {
  receipt_po: 'Nhập PO',
  receipt_consignment: 'Nhập ký gửi',
  receipt_return: 'Nhập hàng trả',
  auto_allocate: 'Giữ cho đơn',
  release_allocation: 'Nhả giữ',
  pick: 'Xuất đi đơn',
  manual_adjust: 'Điều chỉnh tay',
  transfer_in: 'Chuyển đến',
  transfer_out: 'Chuyển đi',
  migration: 'Migration',
};

interface Props {
  items: InventoryRow[];
  canManage: boolean;
}

type UpsertForm = {
  sku: string; warehouseCode: WarehouseCode;
  productTitle: string; variantTitle: string;
  shelf: string; floor: string; bin: string; note: string;
};

const EMPTY_FORM: UpsertForm = {
  sku: '', warehouseCode: 'GVM', productTitle: '', variantTitle: '',
  shelf: '', floor: '', bin: '', note: '',
};

export function WarehouseBoard({ items, canManage }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ALL');

  // Mã kho hiển thị làm tab: suy từ dữ liệu, sắp theo GVM/AP/DM rồi tên lạ.
  const warehouseCodes = (() => {
    const present = Array.from(new Set(items.map((i) => i.warehouseCode)));
    const ordered = WAREHOUSE_ORDER.filter((w) => present.includes(w));
    const extras = present.filter((w) => !(WAREHOUSE_ORDER as readonly string[]).includes(w)).sort();
    const all = [...ordered, ...extras];
    return all.length > 0 ? all : [...WAREHOUSE_ORDER];
  })();
  const upsertCodes: WarehouseCode[] = [...WAREHOUSE_ORDER];

  // Drawer per-unit (danh sách món + lịch sử movement, tự load khi mở)
  const [drawerRow, setDrawerRow] = useState<InventoryRow | null>(null);

  // Dialog điều chỉnh / chuyển kho
  const [adjustItem, setAdjustItem] = useState<InventoryRow | null>(null);
  const [transferItem, setTransferItem] = useState<InventoryRow | null>(null);

  // Form thêm/sửa metadata SKU
  const [form, setForm] = useState<UpsertForm>(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = tab === 'ALL' ? items : items.filter((i) => i.warehouseCode === tab);
  const showWarehouseCol = tab === 'ALL';

  function loadRow(item: InventoryRow) {
    setEditingKey(`${item.sku}@${item.warehouseCode}`);
    setForm({
      sku: item.sku,
      warehouseCode: (WAREHOUSE_ORDER as readonly string[]).includes(item.warehouseCode)
        ? (item.warehouseCode as WarehouseCode)
        : 'GVM',
      productTitle: item.productTitle ?? '',
      variantTitle: item.variantTitle ?? '',
      shelf: item.shelf ?? '',
      floor: item.floor ?? '',
      bin: item.bin ?? '',
      note: item.note ?? '',
    });
    setFormError(null);
  }

  function resetForm() {
    setEditingKey(null);
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
      try {
        const payload: WarehouseItemInput = {
          sku: form.sku,
          warehouseCode: form.warehouseCode,
          productTitle: form.productTitle || null,
          variantTitle: form.variantTitle || null,
          shelf: form.shelf || null,
          floor: form.floor || null,
          bin: form.bin || null,
          note: form.note || null,
        };
        await upsertWarehouseItem(payload);
        resetForm();
        router.refresh();
      } catch (e) {
        setFormError(e instanceof Error && e.message ? e.message : 'Không lưu được SKU.');
      }
    });
  }

  // SKU · (Kho) · Tên · Khả dụng · Tồn · Giữ · Kệ/Tầng/Bin · Ghi chú · Hành động
  const colSpan = 8 + (showWarehouseCol ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Add / Edit metadata form — KHÔNG có ô số lượng: tồn chỉ đổi qua Điều chỉnh / Chuyển kho (ledger). */}
      {canManage && (
        <div className="rounded-lg border border-border bg-background p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editingKey ? `Sửa SKU: ${editingKey}` : 'Thêm / Sửa SKU (thông tin & vị trí)'}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">SKU *</label>
              <input
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                disabled={isPending || !!editingKey}
                placeholder="VD: SKU-001"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Kho</label>
              <select
                value={form.warehouseCode}
                onChange={(e) => setForm((f) => ({ ...f, warehouseCode: e.target.value as WarehouseCode }))}
                disabled={isPending || !!editingKey}
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              >
                {upsertCodes.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tên sản phẩm</label>
              <input
                value={form.productTitle}
                onChange={(e) => setForm((f) => ({ ...f, productTitle: e.target.value }))}
                disabled={isPending}
                placeholder="Tên SP"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Variant</label>
              <input
                value={form.variantTitle}
                onChange={(e) => setForm((f) => ({ ...f, variantTitle: e.target.value }))}
                disabled={isPending}
                placeholder="Màu / Size"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Kệ</label>
              <input
                value={form.shelf}
                onChange={(e) => setForm((f) => ({ ...f, shelf: e.target.value }))}
                disabled={isPending}
                placeholder="A / B"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tầng</label>
              <input
                value={form.floor}
                onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))}
                disabled={isPending}
                placeholder="1 / 2"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Bin</label>
              <input
                value={form.bin}
                onChange={(e) => setForm((f) => ({ ...f, bin: e.target.value }))}
                disabled={isPending}
                placeholder="01 / 02"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ghi chú</label>
              <input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                disabled={isPending}
                placeholder="Ghi chú"
                className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Số lượng tồn không sửa ở đây — dùng nút &quot;Điều chỉnh&quot; / &quot;Chuyển kho&quot; trên từng dòng để mọi biến động vào sổ kho.
          </p>
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
            {editingKey && (
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

      {/* Tabs kho — suy từ dữ liệu (GVM/AP/DM/…) + Tất cả */}
      <div className="flex items-center gap-1 text-sm">
        {[...warehouseCodes, 'ALL'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 font-medium ${
              tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t === 'ALL' ? 'Tất cả' : t}
          </button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">{visible.length} dòng</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">SKU</th>
              {showWarehouseCol && <th className="px-3 py-2 text-left">Kho</th>}
              <th className="px-3 py-2 text-left">Tên</th>
              <th className="px-3 py-2 text-right">Khả dụng</th>
              <th className="px-3 py-2 text-right">Tồn</th>
              <th className="px-3 py-2 text-right">Giữ</th>
              <th className="px-3 py-2 text-left">Kệ/Tầng/Bin</th>
              <th className="px-3 py-2 text-left">Ghi chú</th>
              <th className="px-3 py-2 text-left">Hành động</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center font-sans text-muted-foreground">
                  Chưa có SKU nào trong kho{tab === 'ALL' ? '' : ` ${tab}`}.
                </td>
              </tr>
            ) : (
              visible.map((item) => {
                const name = [item.productTitle, item.variantTitle].filter(Boolean).join(' — ');
                const location = [item.shelf, item.floor, item.bin].filter(Boolean).join(' / ');
                return (
                  <tr
                    key={item.id}
                    onClick={() => setDrawerRow(item)}
                    className="cursor-pointer border-t border-border hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 font-sans">{item.sku}</td>
                    {showWarehouseCol && <td className="px-3 py-2 font-sans">{item.warehouseCode}</td>}
                    <td className="px-3 py-2 font-sans">{name || '—'}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        item.available <= 0
                          ? 'text-red-600 dark:text-red-400'
                          : item.available <= 5
                          ? 'text-amber-600 dark:text-amber-400'
                          : ''
                      }`}
                    >
                      {fmtQty(item.available)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtQty(item.qtyOnHand)}</td>
                    <td className="px-3 py-2 text-right">{fmtQty(item.qtyReserved)}</td>
                    <td className="px-3 py-2 font-sans">{location || '—'}</td>
                    <td className="px-3 py-2 font-sans text-xs text-muted-foreground">{item.note ?? '—'}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDrawerRow(item)}
                          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                        >
                          Chi tiết
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => setAdjustItem(item)}
                              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                            >
                              Điều chỉnh
                            </button>
                            <button
                              type="button"
                              onClick={() => setTransferItem(item)}
                              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                            >
                              Chuyển kho
                            </button>
                            <button
                              type="button"
                              onClick={() => loadRow(item)}
                              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                            >
                              Sửa
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {drawerRow && (
        // key theo dòng tồn → đổi dòng là remount, state items/movements/error về null sạch sẽ.
        <ItemDrawer
          key={drawerRow.id}
          item={drawerRow}
          warehouseCode={tab === 'ALL' ? undefined : tab}
          onClose={() => setDrawerRow(null)}
        />
      )}
      {adjustItem && (
        <AdjustDialog
          key={adjustItem.id}
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onDone={() => { setAdjustItem(null); router.refresh(); }}
        />
      )}
      {transferItem && (
        <TransferDialog
          key={transferItem.id}
          item={transferItem}
          onClose={() => setTransferItem(null)}
          onDone={() => { setTransferItem(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

/** Giá vốn món: số + đơn vị tiền tệ. */
function fmtMoney(amount: string | null, currency: string | null): string {
  if (!amount) return '—';
  const n = Number(amount);
  const formatted = Number.isFinite(n) ? new Intl.NumberFormat('vi-VN').format(n) : amount;
  return currency ? `${formatted} ${currency}` : formatted;
}

type DrawerTab = 'items' | 'history';

/** Drawer per-unit của một dòng rollup: danh sách MÓN + lịch sử movement.
 *  Cả hai tải lười khi mở tab tương ứng; key theo dòng → remount sạch state. */
function ItemDrawer({
  item, warehouseCode, onClose,
}: {
  item: InventoryRow;
  warehouseCode?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<DrawerTab>('items');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background px-5 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                {item.sku} @ {item.warehouseCode}
              </h2>
              <p className="text-xs text-muted-foreground">
                Tồn {fmtQty(item.qtyOnHand)} · Giữ {fmtQty(item.qtyReserved)} · Khả dụng {fmtQty(item.available)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex gap-1 text-sm">
            {(['items', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setView(t)}
                className={`rounded px-3 py-1 font-medium ${
                  view === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {t === 'items' ? 'Danh sách món' : 'Lịch sử kho'}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          {view === 'items'
            ? <ItemList sku={item.sku} warehouseCode={warehouseCode} />
            : <MovementHistory inventoryId={item.id} />}
        </div>
      </div>
    </div>
  );
}

/** Bảng từng MÓN của SKU — tải qua getItems khi hiển thị. */
function ItemList({ sku, warehouseCode }: { sku: string; warehouseCode?: string }) {
  const [items, setItems] = useState<WarehouseItemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getItems(sku, warehouseCode)
      .then((rows) => { if (alive) setItems(rows); })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error && e.message ? e.message : 'Không tải được danh sách món.');
      });
    return () => { alive = false; };
  }, [sku, warehouseCode]);

  if (error) return <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (items === null) return <p className="py-8 text-center text-sm text-muted-foreground">Đang tải danh sách món…</p>;
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Không có món nào cho SKU này.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="py-1 pr-2 text-left">Mã WH</th>
          <th className="py-1 pr-2 text-left">Vị trí</th>
          <th className="py-1 pr-2 text-left">Trạng thái</th>
          <th className="py-1 pr-2 text-left">Nguồn</th>
          <th className="py-1 pr-2 text-left">Ngày nhập</th>
          <th className="py-1 pr-2 text-right">Giá vốn</th>
          <th className="py-1 text-left">Đơn</th>
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {items.map((it) => (
          <tr key={it.id} className="border-t border-border align-top">
            <td className="py-1.5 pr-2 text-xs">{it.unitCode}</td>
            <td className="py-1.5 pr-2 font-sans text-xs">{it.location ?? '—'}</td>
            <td className="py-1.5 pr-2 font-sans text-xs">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${STOCK_STATUS_CLASS[it.stockStatus] ?? 'bg-muted text-muted-foreground'}`}>
                {STOCK_STATUS_LABEL[it.stockStatus] ?? it.stockStatus}
              </span>
            </td>
            <td className="py-1.5 pr-2 font-sans text-xs text-muted-foreground">{it.source ?? '—'}</td>
            <td className="whitespace-nowrap py-1.5 pr-2 text-xs">
              {it.receivedAt ? new Date(it.receivedAt).toLocaleDateString('vi-VN') : '—'}
            </td>
            <td className="py-1.5 pr-2 text-right text-xs">{fmtMoney(it.domPrice, it.domPriceCurrency)}</td>
            <td className="py-1.5 font-sans text-xs">
              {it.order ? (
                <Link
                  href={`/f/fulfillment/${it.order.orderId}`}
                  className="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                >
                  #{it.order.orderNumber}
                </Link>
              ) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Lịch sử movement của dòng rollup — tải qua getMovements khi hiển thị. */
function MovementHistory({ inventoryId }: { inventoryId: string }) {
  const [movements, setMovements] = useState<MovementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMovements(inventoryId)
      .then((rows) => { if (alive) setMovements(rows); })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error && e.message ? e.message : 'Không tải được lịch sử.');
      });
    return () => { alive = false; };
  }, [inventoryId]);

  if (error) return <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (movements === null) return <p className="py-8 text-center text-sm text-muted-foreground">Đang tải lịch sử…</p>;
  if (movements.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Chưa có biến động nào cho dòng tồn này.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="py-1 pr-2 text-left">Lúc</th>
          <th className="py-1 pr-2 text-left">Lý do</th>
          <th className="py-1 pr-2 text-right">ΔTồn</th>
          <th className="py-1 pr-2 text-right">ΔGiữ</th>
          <th className="py-1 pr-2 text-left">Tham chiếu</th>
          <th className="py-1 pr-2 text-left">Ghi chú</th>
          <th className="py-1 text-left">Người</th>
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {movements.map((m) => (
          <tr key={m.id} className="border-t border-border align-top">
            <td className="whitespace-nowrap py-1.5 pr-2 text-xs">
              {new Date(m.createdAt).toLocaleString('vi-VN')}
            </td>
            <td className="py-1.5 pr-2 font-sans text-xs">
              {REASON_LABEL[m.reason] ?? m.reason}
            </td>
            <td className={`py-1.5 pr-2 text-right ${deltaClass(m.deltaOnHand)}`}>
              {m.deltaOnHand === 0 ? '—' : fmtDelta(m.deltaOnHand)}
            </td>
            <td className={`py-1.5 pr-2 text-right ${deltaClass(m.deltaReserved)}`}>
              {m.deltaReserved === 0 ? '—' : fmtDelta(m.deltaReserved)}
            </td>
            <td className="py-1.5 pr-2 font-sans text-xs">
              {m.ref === null ? (
                '—'
              ) : m.ref.kind === 'order' ? (
                <Link
                  href={`/f/fulfillment/${m.ref.orderId}`}
                  className="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                >
                  #{m.ref.orderNumber}
                </Link>
              ) : (
                m.ref.code
              )}
            </td>
            <td className="py-1.5 pr-2 font-sans text-xs text-muted-foreground">{m.note ?? '—'}</td>
            <td className="py-1.5 font-sans text-xs text-muted-foreground">{m.actor}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function deltaClass(n: number): string {
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (n < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

/** Điều chỉnh tay: delta ≠ 0 + lý do bắt buộc → adjustStock (vào ledger). */
function AdjustDialog({
  item, onClose, onDone,
}: {
  item: InventoryRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deltaNum = Number(delta);
  const invalid = !delta.trim() || !Number.isInteger(deltaNum) || deltaNum === 0 || !note.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await adjustStock({
        sku: item.sku,
        warehouseCode: item.warehouseCode,
        delta: deltaNum,
        note: note.trim(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Không điều chỉnh được.');
      setBusy(false);
    }
  }

  return (
    <DialogShell title={`Điều chỉnh: ${item.sku} @ ${item.warehouseCode}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Tồn hiện tại {fmtQty(item.qtyOnHand)} · Giữ {fmtQty(item.qtyReserved)}. Delta âm để trừ, dương để cộng.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Delta (≠ 0) *</label>
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          disabled={busy}
          placeholder="VD: -2 hoặc 5"
          className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Lý do *</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          rows={2}
          placeholder="VD: kiểm kê thấy thiếu 2 cái / nhập bù hàng lỗi…"
          className="rounded border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || invalid}
          onClick={submit}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Đang lưu…' : 'Xác nhận điều chỉnh'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Huỷ
        </button>
      </div>
    </DialogShell>
  );
}

/** Chuyển kho GVM/AP/DM: from cố định theo dòng, to là kho còn lại. */
function TransferDialog({
  item, onClose, onDone,
}: {
  item: InventoryRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const otherWarehouses = WAREHOUSE_ORDER.filter((w) => w !== item.warehouseCode);
  const [to, setTo] = useState<string>(otherWarehouses[0] ?? 'AP');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qtyNum = Number(qty);
  const invalid = !qty.trim() || !Number.isInteger(qtyNum) || qtyNum <= 0 || !to;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await transferStock({
        sku: item.sku,
        from: item.warehouseCode,
        to,
        qty: qtyNum,
        note: note.trim() || null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Không chuyển kho được.');
      setBusy(false);
    }
  }

  return (
    <DialogShell title={`Chuyển kho: ${item.sku}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Khả dụng tại {item.warehouseCode}: {fmtQty(item.available)} (hàng đang giữ cho đơn không chuyển được).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Từ kho</label>
          <input
            value={item.warehouseCode}
            disabled
            className="rounded border border-border bg-muted/40 px-2 py-1 text-sm opacity-70"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Đến kho</label>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
            className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
          >
            {otherWarehouses.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Số lượng (&gt; 0) *</label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          disabled={busy}
          placeholder="VD: 3"
          className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Ghi chú</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          placeholder="Không bắt buộc"
          className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-60"
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || invalid}
          onClick={submit}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Đang chuyển…' : 'Xác nhận chuyển kho'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Huỷ
        </button>
      </div>
    </DialogShell>
  );
}

function DialogShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:p-10" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 p-5">{children}</div>
      </div>
    </div>
  );
}
