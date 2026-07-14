'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { currencyDecimals } from '@/lib/currency-format';
import { CONFIDENCE_MAP } from '@/lib/address/confidence';
import {
  Pencil, Save, RotateCcw, Loader2, Search, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import type { OrderDetail } from '@/features/shopify-orders/order-actions';
import type { OrderRow } from '@/features/shopify-orders/dashboard-actions';
import { OrderPnlPanel } from './OrderPnlPanel';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

interface OrdersTableProps {
  storeId: string;
  /** First page, server-rendered so the table paints instantly. */
  initialRows: OrderRow[];
  /** Total orders in the store (matching current search) across all pages. */
  initialTotalCount: number;
  /** Server action (getStoreOrdersPage) — fetches one page of the store's
   *  full order history. Bound to no store; the table passes storeId. */
  fetchPageAction: (args: {
    storeId: string;
    page: number;
    pageSize: number;
    search: string;
    sort: 'newest' | 'oldest';
  }) => Promise<{ rows: OrderRow[]; totalCount: number }>;
  canEdit: boolean;
  /** Currency the operator enters COGs/shipping overrides in (e.g. 'VND'
   *  for Mirer). Falls back to the order currency when not set. */
  costCurrency: string | null;
  /** How many `costCurrency` units equal one order-currency unit (e.g.
   *  26000 for USD orders + VND costs). When both this and `costCurrency`
   *  are set, the Ship cost column flips into a cost-currency view so the
   *  operator can reconcile against carrier invoices in their bank-side
   *  currency without doing FX in their head. */
  fxRate: number | null;
  getDetailAction: (orderId: string) => Promise<OrderDetail | null>;
  saveAction: (input: {
    orderId: string;
    lineCosts: Record<string, number | null>;
    shippingCostOverride: number | null;
    shippingCostOverrideNote: string | null;
    shipWeightKgOverride: number | null;
  }) => Promise<{ linesUpdated: number; shippingUpdated: boolean }>;
}

export function OrdersTable({
  storeId, initialRows, initialTotalCount, fetchPageAction,
  canEdit, costCurrency, fxRate, getDetailAction, saveAction,
}: OrdersTableProps) {
  // The Ship cost column flips into "cost currency" mode whenever both the
  // brand's cost currency and the FX rate are known. Revenue and everything
  // else stays in the order currency — the goal of this column flip is
  // purely visual reconciliation against carrier invoices, not changing the
  // P&L math (which still happens in the order currency upstream).
  const showShipInCostCurrency = costCurrency !== null && fxRate !== null && fxRate > 0;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  // Server-driven pagination: the table shows the store's ENTIRE order history
  // one page at a time. Each page / size / search change refetches just that
  // page via getStoreOrdersPage instead of shipping every order to the browser,
  // so payload stays flat no matter how large the store's history grows.
  const [rows, setRows] = useState<OrderRow[]>(initialRows);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = (next: { page: number; pageSize: number; search: string }): void => {
    startTransition(async () => {
      const res = await fetchPageAction({
        storeId,
        page: next.page,
        pageSize: next.pageSize,
        search: next.search,
        sort: 'newest',
      });
      setRows(res.rows);
      setTotalCount(res.totalCount);
    });
  };

  const goPage = (p: number): void => {
    setPage(p);
    load({ page: p, pageSize, search });
  };
  const changePageSize = (s: PageSize): void => {
    setPageSize(s);
    setPage(0);
    load({ page: 0, pageSize: s, search });
  };
  // Debounce search so we don't fire a query per keystroke. Matches the
  // server action's own normalisation (leading '#' stripped, order number +
  // recipient name), so the client hint stays truthful.
  const onSearchChange = (v: string): void => {
    setSearch(v);
    setPage(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load({ page: 0, pageSize, search: v }), 350);
  };

  const openRow = async (orderId: string): Promise<void> => {
    if (!canEdit) return;
    setLoading(true);
    setOpen(true);
    try {
      setDetail(await getDetailAction(orderId));
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * pageSize;
  const endIdx = startIdx + rows.length;
  const visible = rows;

  // Unpriced diagnostic — over the CURRENT page only (the rows we hold). With
  // all-time server pagination we no longer have every order in memory, so this
  // reflects "unpriced on this page" — still enough to spot a systemic gap.
  const unpriced = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const o of rows) {
      if (o.shippingCostSource !== 'unknown') continue;
      total += 1;
      const key = o.shippingCostReason ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return { total, counts };
  }, [rows]);

  return (
    <>
      <Card>
        {/* Toolbar: search + page-size selector + result count */}
        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm theo mã đơn hoặc tên người nhận — vd 1234, #MR1234"
              className="w-full h-8 pl-8 pr-8 border border-input bg-input/30 rounded-md text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Tìm đơn theo mã đơn hoặc tên người nhận"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono tabular-nums whitespace-nowrap inline-flex items-center gap-1.5">
            {pending && <Loader2 className="size-3 animate-spin" />}
            {totalCount === 0
              ? (search ? 'Không có đơn khớp' : 'Chưa có đơn')
              : `${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} / ${totalCount.toLocaleString()}`}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground uppercase tracking-wider">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value) as PageSize)}
              className="h-7 border border-input bg-input/30 rounded-md px-1.5 text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Diagnostic strip — only shown when at least one shipment in the
            current view couldn't be priced. Breaks the count down by reason
            so the operator can see whether the fix is in Shopify (weights),
            in markets (no country coverage), or in carrier links. */}
        {unpriced.total > 0 && (
          <div className="flex items-start gap-2 px-3 py-2 border-b border-border bg-amber-500/[0.06] text-xs">
            <span
              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium font-mono tabular-nums whitespace-nowrap"
              title="Shipping cost couldn't be computed for these orders. Hover the breakdown for the cause."
            >
              {unpriced.total.toLocaleString()} unpriced
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              {Object.entries(unpriced.counts)
                .sort(([, a], [, b]) => b - a)
                .map(([reason, n]) => (
                  <span
                    key={reason}
                    title={reasonLabel(reason as OrderRow['shippingCostReason'])}
                    className="cursor-help underline decoration-dotted underline-offset-2"
                  >
                    {reasonShortLabel(reason as OrderRow['shippingCostReason'])}: <span className="font-mono tabular-nums">{n}</span>
                  </span>
                ))}
            </div>
          </div>
        )}

        {/*
          Constrain the table to its own scroll context so the column
          headers can stay sticky as the operator scrolls through long
          pages. `max-h: viewport - chrome` keeps the toolbar, KPIs, and
          filters visible above the table; `min-h` prevents the table
          from collapsing to nothing on tall datasets.

          `overflow-auto` (not just `-x`) is required for sticky to take
          effect inside the card — sticky positioning needs a scroll
          container.
        */}
        <CardContent className="p-0 overflow-auto max-h-[calc(100vh-22rem)] min-h-[280px]">
          <table className="w-full text-sm">
            {/*
              Sticky to the CardContent scroll viewport. `bg-card` covers
              the rows scrolling underneath; the shadow gives a subtle
              depth cue when the user has scrolled past the start.
              z-10 keeps the header above sticky cells should we ever
              add a sticky first column.
            */}
            <thead className="sticky top-0 z-10 bg-card text-xs uppercase tracking-wider text-muted-foreground border-b border-border shadow-[0_1px_0_0_var(--color-border)]">
              <tr>
                <th className="text-left px-3 py-2">Order #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Lines</th>
                <th className="text-right px-3 py-2" title="Line items only — sum of unit_price × qty">Subtotal</th>
                <th className="text-right px-3 py-2">Refunded</th>
                <th className="text-right px-3 py-2">Discount</th>
                <th className="text-right px-3 py-2">Ship rev</th>
                <th className="text-right px-3 py-2" title="GMV = Subtotal + Ship rev">GMV</th>
                <th className="text-right px-3 py-2" title="Margin ship = Ship rev − Ship cost (billed thật khi có, engine khi chưa). Âm = charge thiếu. Chi tiết cost: bấm vào đơn.">
                  Margin ship
                  {showShipInCostCurrency && (
                    <span
                      className="ml-1 px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-mono normal-case tracking-normal"
                      title={`Displayed in ${costCurrency} at FX ${fxRate!.toLocaleString()}.`}
                    >
                      {costCurrency}
                    </span>
                  )}
                </th>
                <th className="text-right px-3 py-2">SKU cost</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">Margin %</th>
                <th className="text-left px-3 py-2">Overrides</th>
                {canEdit && <th className="px-3 py-2 w-10" aria-label="Edit" />}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 14 : 13} className="px-4 py-6 text-center text-muted-foreground">
                    {totalCount === 0 && !search
                      ? 'Chưa có đơn nào.'
                      : `Không có đơn khớp "${search}".`}
                  </td>
                </tr>
              )}
              {visible.map((o) => (
                <tr
                  key={o.orderId}
                  onClick={() => canEdit && openRow(o.orderId)}
                  className={`border-b border-border/40 ${canEdit ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                >
                  <td className="px-3 py-2 font-mono">{o.shopifyOrderNumber}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(o.processedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{o.lineCount}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(o.subtotal, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-destructive">
                    {o.refundedAmount > 0 ? fmt(o.refundedAmount, o.currency) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(o.discount, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(o.shippingRevenue, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">{fmt(o.gmv, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {o.shipMarginRaw === null ? (
                      <span
                        className="text-amber-600 dark:text-amber-400 cursor-help underline decoration-dotted underline-offset-2"
                        title={o.shippingCostSource === 'unknown' ? reasonLabel(o.shippingCostReason) : 'Chưa biết ship cost'}
                      >
                        —
                      </span>
                    ) : (
                      <span
                        className={o.shipMarginRaw < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
                        title={`Ship rev − ship cost · ${o.shippingCostSource === 'engine_estimate' ? 'tạm tính (chưa có hoá đơn carrier)' : 'billed thật'}`}
                      >
                        {fmt(o.shipMarginRaw, o.shipMarginRawCurrency || costCurrency || o.currency)}
                        {o.shippingCostSource === 'engine_estimate' && (
                          <span className="ml-1 text-[9px] text-muted-foreground normal-case">tạm</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {o.skuCostCoverage === 0 ? (
                      <span className="text-amber-600 dark:text-amber-400" title="no SKU cost data">—</span>
                    ) : (
                      fmt(o.skuCost, o.currency)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">{fmt(o.revenue, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {o.netGmv > 0 ? `${(o.margin * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {o.hasOverrides ? (
                      <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider">
                        manual
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60">default</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      <Pencil className="size-3.5 inline" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>

        {/* Pagination — hide entirely when there's no more than one page. */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border text-xs">
            <span className="text-muted-foreground font-mono tabular-nums">
              Page {safePage + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <PageButton onClick={() => goPage(0)} disabled={safePage === 0 || pending} ariaLabel="First page">
                <ChevronsLeft className="size-3.5" />
              </PageButton>
              <PageButton onClick={() => goPage(safePage - 1)} disabled={safePage === 0 || pending} ariaLabel="Previous page">
                <ChevronLeft className="size-3.5" />
              </PageButton>
              <PageButton onClick={() => goPage(safePage + 1)} disabled={safePage >= totalPages - 1 || pending} ariaLabel="Next page">
                <ChevronRight className="size-3.5" />
              </PageButton>
              <PageButton onClick={() => goPage(totalPages - 1)} disabled={safePage >= totalPages - 1 || pending} ariaLabel="Last page">
                <ChevronsRight className="size-3.5" />
              </PageButton>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail ? `Order ${detail.shopifyOrderNumber}` : 'Loading…'}
            </DialogTitle>
            <DialogDescription>
              Chi tiết đơn + so sánh phí ship (khách trả vs hệ thống vs billed thực tế). Bấm “Sửa” để chỉnh giá vốn từng dòng / cân nặng. Chi phí ship billed tự lấy từ hoá đơn carrier — không sửa tay.
            </DialogDescription>
          </DialogHeader>
          {loading || !detail ? (
            <div className="py-12 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
              <Loader2 className="size-4 animate-spin" /> Loading order detail…
            </div>
          ) : (
            <OrderEditForm
              detail={detail}
              costCurrency={costCurrency}
              saveAction={saveAction}
              onSaved={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface OrderEditFormProps {
  detail: OrderDetail;
  costCurrency: string | null;
  saveAction: OrdersTableProps['saveAction'];
  onSaved: () => void;
}

function OrderEditForm({ detail, costCurrency, saveAction, onSaved }: OrderEditFormProps) {
  const cogsCcy = costCurrency || detail.currency;
  const sameCcy = cogsCcy === detail.currency;
  // Initial state mirrors whatever's already in the DB. Empty string = no
  // override; falls back to defaults at compute time.
  const [lineCosts, setLineCosts] = useState<Record<string, string>>(
    Object.fromEntries(
      detail.lines.map((l) => [l.lineId, l.costOverride !== null ? String(l.costOverride) : '']),
    ),
  );
  const [shippingNote, setShippingNote] = useState<string>(detail.shipping.shippingCostOverrideNote ?? '');
  const [weightOverride, setWeightOverride] = useState<string>(
    detail.shipWeightKgOverride !== null ? String(detail.shipWeightKgOverride) : '',
  );
  // Mở ra là XEM (read-only); bấm "Sửa" mới cho chỉnh. Billing không sửa tay.
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSave = (): void => {
    const lineCostsPayload: Record<string, number | null> = {};
    for (const [id, raw] of Object.entries(lineCosts)) {
      const trimmed = raw.trim();
      lineCostsPayload[id] = trimmed === '' ? null : Number(trimmed);
    }
    const weight = weightOverride.trim() === '' ? null : Number(weightOverride);
    startTransition(async () => {
      await saveAction({
        orderId: detail.orderId,
        lineCosts: lineCostsPayload,
        // Chi phí ship billed tự lấy từ hoá đơn carrier → KHÔNG sửa tay. Giữ
        // nguyên giá trị override cũ (nếu có) để không xoá dữ liệu lịch sử.
        shippingCostOverride: detail.shipping.shippingCostOverride,
        shippingCostOverrideNote: shippingNote.trim() === '' ? null : shippingNote.trim(),
        shipWeightKgOverride: weight,
      });
      setEditing(false);
      onSaved();
    });
  };

  const onReset = (): void => {
    setLineCosts(Object.fromEntries(detail.lines.map((l) => [l.lineId, ''])));
    setShippingNote('');
    setWeightOverride('');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>Ngày xử lý: <span className="text-foreground">{new Date(detail.processedAt).toLocaleDateString()}</span></span>
        <span>
          Ngày đi hàng:{' '}
          {detail.shipDate
            ? <span className="text-foreground">{new Date(detail.shipDate).toLocaleDateString()}</span>
            : <span className="italic">chưa có</span>}
        </span>
      </div>
      <AddressVerifyCard address={detail.address} country={detail.shipCountry} />
      {/* Lines */}
      <section>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Line items</div>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">SKU · Product</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Unit price</th>
                  <th className="text-right px-3 py-2">Default cost</th>
                  <th className="text-right px-3 py-2 w-44">
                    Cost override / unit
                    {!sameCcy && (
                      <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-mono">
                        {cogsCcy}
                      </span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.lineId} className="border-b border-border/40">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{l.sku ?? '(no sku)'}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-xs">
                        {l.productTitle}{l.variantTitle ? ` · ${l.variantTitle}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{l.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {fmt(Number(l.unitPrice), detail.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                      {l.defaultCostPerUnit !== null
                        ? fmt(l.defaultCostPerUnit, l.defaultCostCurrency ?? detail.currency)
                        : <span className="italic text-amber-600 dark:text-amber-400">no cost</span>}
                    </td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <div className="flex items-center gap-1.5">
                          <MoneyInput
                            value={lineCosts[l.lineId] ?? ''}
                            onValueChange={(raw) =>
                              setLineCosts((s) => ({ ...s, [l.lineId]: raw }))
                            }
                            decimals={currencyDecimals(cogsCcy)}
                            placeholder={l.defaultCostPerUnit !== null
                              ? `default: ${l.defaultCostPerUnit.toLocaleString()}`
                              : 'blank = no cost'}
                            inputClassName="h-8 text-xs text-right px-2"
                            className="flex-1"
                          />
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{cogsCcy}</span>
                        </div>
                      ) : (
                        <div className="text-right font-mono tabular-nums text-xs">
                          {l.costOverride !== null
                            ? <>{fmt(l.costOverride, cogsCcy)} <span className="text-[9px] text-muted-foreground">{cogsCcy}</span></>
                            : <span className="text-muted-foreground/60">—</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Shipping */}
      <section>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">P&L đơn hàng</div>
        <Card>
          <CardContent className="p-4 space-y-3 text-sm">
            <OrderPnlPanel detail={detail} />

            {/* Cân nặng + ghi chú — chỉ sửa ở Edit mode. Chi phí ship billed
                KHÔNG có ô override (tự lấy từ hoá đơn carrier). */}
            {editing ? (
              <>
                <label className="block space-y-1">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                    Weight override
                    <span className="text-[10px] font-mono normal-case tracking-normal text-muted-foreground/80">
                      snapshot: {detail.shipWeightKg !== null ? `${detail.shipWeightKg.toFixed(3)} kg` : '—'}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      placeholder="blank = use Shopify snapshot weight"
                      value={weightOverride}
                      onChange={(e) => setWeightOverride(e.target.value)}
                      className="flex-1 h-9 border border-input bg-input/30 rounded-md px-3 text-sm font-mono tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <span className="text-xs font-mono text-muted-foreground shrink-0">kg</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Dùng khi cân variant sai lúc sync và đã bị snapshot. Sửa variant
                    trên Shopify không cập nhật ngược đơn cũ — ô này trỏ engine về
                    đúng cân để tra cước.
                  </p>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Note (optional)</span>
                  <input
                    type="text"
                    placeholder="e.g. comp shipment / GoBear courier"
                    value={shippingNote}
                    onChange={(e) => setShippingNote(e.target.value)}
                    className="w-full h-9 border border-input bg-input/30 rounded-md px-3 text-sm"
                  />
                </label>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Cân:{' '}
                  <span className="text-foreground font-mono">
                    {detail.shipWeightKgOverride !== null
                      ? `${detail.shipWeightKgOverride} kg (override)`
                      : detail.shipWeightKg !== null ? `${detail.shipWeightKg} kg` : '—'}
                  </span>
                </span>
                {detail.shipping.shippingCostOverrideNote && (
                  <span>Note: <span className="text-foreground">{detail.shipping.shippingCostOverrideNote}</span></span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <DialogFooter className="flex-row sm:justify-between gap-2 pt-2">
        {editing ? (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
              <RotateCcw className="size-3.5" />
              Clear overrides
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
                Huỷ
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={pending} className="gap-1.5">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Lưu
              </Button>
            </div>
          </>
        ) : (
          <Button type="button" size="sm" onClick={() => setEditing(true)} className="gap-1.5 ml-auto">
            <Pencil className="size-3.5" />
            Sửa
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

interface PageButtonProps {
  onClick: () => void;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}

/**
 * Square chevron button used by the pagination strip. Disabled buttons
 * stay rendered (so the row doesn't reflow) but lose their hover state.
 */
function PageButton({ onClick, disabled, ariaLabel, children }: PageButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="size-7 inline-flex items-center justify-center rounded-md border border-input bg-input/30 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40 disabled:hover:bg-input/30 disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function reasonShortLabel(reason: OrderRow['shippingCostReason']): string {
  switch (reason) {
    case 'no_country': return 'no country';
    case 'no_weight': return 'no weight';
    case 'no_market': return 'no market';
    case 'no_carrier_link': return 'no carrier';
    case 'no_carrier_accounts': return 'no carriers';
    case 'no_quote': return 'no quote';
    default: return 'unknown';
  }
}

function reasonLabel(reason: OrderRow['shippingCostReason']): string {
  switch (reason) {
    case 'no_country':
      return 'No shipping country on the order (pickup, digital, or draft).';
    case 'no_weight':
      return 'No chargeable weight. Set weights on the variants in Shopify.';
    case 'no_market':
      return 'No enabled market covers this country. Add the country to a market_template.';
    case 'no_carrier_link':
      return 'Markets exist for this country, but no enabled carrier link. Link a carrier in the market.';
    case 'no_carrier_accounts':
      return 'No enabled carrier accounts in the system. Add a FedEx (or other) account in Carrier rates.';
    case 'no_quote':
      return 'None of the configured carriers cover this destination + weight. Extend a carrier zone or add a higher weight tier.';
    default:
      return 'Shipping cost unavailable.';
  }
}

function fmt(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/** Địa chỉ giao + kết quả verify FedEx Address Validation. */
function AddressVerifyCard({
  address,
  country,
}: {
  address: import('@/features/shopify-orders/order-actions').OrderDetail['address'];
  country: string | null;
}) {
  const a = address;
  const hasStreet = !!a.line1;
  const classMap: Record<string, { label: string; cls: string }> = {
    RESIDENTIAL: { label: '🏠 Nhà dân', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    BUSINESS: { label: '🏢 Doanh nghiệp', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
    MIXED: { label: 'Hỗn hợp', cls: 'bg-muted text-muted-foreground' },
    UNKNOWN: { label: 'Chưa rõ', cls: 'bg-muted text-muted-foreground' },
  };
  const cls = a.class ? classMap[a.class] ?? classMap.UNKNOWN : null;
  const fullAddr = [a.name, a.company, a.line1, a.line2, a.city, a.province, a.postcode, country]
    .filter(Boolean).join(', ');
  // Ưu tiên 4 mức addr_confidence; fallback boolean deliverable cho đơn cũ chưa re-verify.
  const conf = a.confidence ? CONFIDENCE_MAP[a.confidence] ?? null : null;
  const danger = conf ? conf.border : a.deliverable === false;

  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Địa chỉ giao</div>
      <Card className={danger ? 'border-red-500/40' : undefined}>
        <CardContent className="p-3 space-y-2 text-sm">
          {hasStreet ? (
            <div className="text-foreground">{fullAddr || '—'}</div>
          ) : (
            <div className="text-muted-foreground italic">Chưa có địa chỉ đầy đủ (đơn cũ — cần re-sync để verify).</div>
          )}
          {a.verifiedAt ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {cls && <span className={`rounded px-2 py-0.5 font-medium ${cls.cls}`}>{cls.label}</span>}
              {conf ? (
                <span className={`rounded px-2 py-0.5 font-medium ${conf.cls}`}>{conf.label}</span>
              ) : (
                <span className={`rounded px-2 py-0.5 font-medium ${a.deliverable ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
                  {a.deliverable ? '✓ Giao được' : '⚠ Không giao được'}
                </span>
              )}
              {a.issue && <span className="rounded px-2 py-0.5 font-medium bg-red-500/10 text-red-600 dark:text-red-400" title="Vấn đề FedEx báo">{a.issue}</span>}
              <span className="text-muted-foreground">· verify {new Date(a.verifiedAt).toLocaleDateString('vi-VN')}</span>
            </div>
          ) : hasStreet ? (
            <div className="text-xs text-muted-foreground">Chưa verify (chờ chạy Address Validation).</div>
          ) : null}
          {a.standardized && a.verifiedAt && a.standardized.toUpperCase() !== fullAddr.toUpperCase() && (
            <div className="text-[11px] text-muted-foreground">FedEx chuẩn hoá: <span className="font-mono">{a.standardized}</span></div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
