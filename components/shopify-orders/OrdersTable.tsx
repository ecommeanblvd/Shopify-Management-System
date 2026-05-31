'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { currencyDecimals } from '@/lib/currency-format';
import {
  Pencil, Save, RotateCcw, Loader2, Search, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import type { OrderDetail } from '@/features/shopify-orders/order-actions';
import type { OrderRow } from '@/features/shopify-orders/dashboard-actions';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

interface OrdersTableProps {
  orders: OrderRow[];
  canEdit: boolean;
  /** Currency the operator enters COGs/shipping overrides in (e.g. 'VND'
   *  for Mirer). Falls back to the order currency when not set. */
  costCurrency: string | null;
  getDetailAction: (orderId: string) => Promise<OrderDetail | null>;
  saveAction: (input: {
    orderId: string;
    lineCosts: Record<string, number | null>;
    shippingCostOverride: number | null;
    shippingCostOverrideNote: string | null;
  }) => Promise<{ linesUpdated: number; shippingUpdated: boolean }>;
}

export function OrdersTable({
  orders, canEdit, costCurrency, getDetailAction, saveAction,
}: OrdersTableProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(25);

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

  // Substring match against the order number. Case-insensitive, ignores
  // a leading "#" so operators can paste from Shopify admin's "#1234" or
  // type "1234" — both work. Memoised so we don't re-scan thousands of
  // orders on every keystroke.
  const filtered = useMemo(() => {
    const q = search.trim().replace(/^#/, '').toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => o.shopifyOrderNumber.toLowerCase().includes(q));
  }, [orders, search]);

  // Reset to page 0 when the result set shrinks under the operator's feet.
  useEffect(() => { setPage(0); }, [search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * pageSize;
  const endIdx = Math.min(startIdx + pageSize, filtered.length);
  const visible = filtered.slice(startIdx, endIdx);

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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order number — e.g. 1234 or #MR1234"
              className="w-full h-8 pl-8 pr-8 border border-input bg-input/30 rounded-md text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Search orders by order number"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono tabular-nums whitespace-nowrap">
            {filtered.length === 0
              ? 'No matches'
              : `${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${filtered.length.toLocaleString()}`}
            {search && filtered.length !== orders.length && (
              <span className="text-muted-foreground/60"> (filtered from {orders.length.toLocaleString()})</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground uppercase tracking-wider">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              className="h-7 border border-input bg-input/30 rounded-md px-1.5 text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left px-3 py-2">Order #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Lines</th>
                <th className="text-right px-3 py-2">GMV</th>
                <th className="text-right px-3 py-2">Refunded</th>
                <th className="text-right px-3 py-2">Discount</th>
                <th className="text-right px-3 py-2">Ship rev</th>
                <th className="text-right px-3 py-2">Ship cost</th>
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
                  <td colSpan={canEdit ? 13 : 12} className="px-4 py-6 text-center text-muted-foreground">
                    {orders.length === 0
                      ? 'No orders in this window.'
                      : `No orders match "${search}".`}
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
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(o.gmv, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-destructive">
                    {o.refundedAmount > 0 ? fmt(o.refundedAmount, o.currency) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(o.discount, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(o.shippingRevenue, o.currency)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {o.shippingCostSource === 'unknown' ? (
                      <span className="text-muted-foreground/60">—</span>
                    ) : (
                      <span title={o.shippingCostSource}>{fmt(o.shippingCost, o.currency)}</span>
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
              <PageButton onClick={() => setPage(0)} disabled={safePage === 0} ariaLabel="First page">
                <ChevronsLeft className="size-3.5" />
              </PageButton>
              <PageButton onClick={() => setPage(safePage - 1)} disabled={safePage === 0} ariaLabel="Previous page">
                <ChevronLeft className="size-3.5" />
              </PageButton>
              <PageButton onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1} ariaLabel="Next page">
                <ChevronRight className="size-3.5" />
              </PageButton>
              <PageButton onClick={() => setPage(totalPages - 1)} disabled={safePage >= totalPages - 1} ariaLabel="Last page">
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
              {detail ? `Edit order ${detail.shopifyOrderNumber}` : 'Loading…'}
            </DialogTitle>
            <DialogDescription>
              Override the cost-of-goods per line and / or the shipping cost for this order. Leave a field blank to fall back to the system default (sku_costs lookup, shipping invoice, or carrier-engine estimate).
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
  const [shippingOverride, setShippingOverride] = useState<string>(
    detail.shipping.shippingCostOverride !== null ? String(detail.shipping.shippingCostOverride) : '',
  );
  const [shippingNote, setShippingNote] = useState<string>(detail.shipping.shippingCostOverrideNote ?? '');
  const [pending, startTransition] = useTransition();

  const onSave = (): void => {
    const lineCostsPayload: Record<string, number | null> = {};
    for (const [id, raw] of Object.entries(lineCosts)) {
      const trimmed = raw.trim();
      lineCostsPayload[id] = trimmed === '' ? null : Number(trimmed);
    }
    const ship = shippingOverride.trim() === '' ? null : Number(shippingOverride);
    startTransition(async () => {
      await saveAction({
        orderId: detail.orderId,
        lineCosts: lineCostsPayload,
        shippingCostOverride: ship,
        shippingCostOverrideNote: shippingNote.trim() === '' ? null : shippingNote.trim(),
      });
      onSaved();
    });
  };

  const onReset = (): void => {
    setLineCosts(Object.fromEntries(detail.lines.map((l) => [l.lineId, ''])));
    setShippingOverride('');
    setShippingNote('');
  };

  return (
    <div className="space-y-5">
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
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Shipping</div>
        <Card>
          <CardContent className="p-4 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shipping revenue (customer paid)" value={fmt(detail.shipping.shippingRevenue, detail.currency)} />
              <Field
                label={`Default cost (${detail.shipping.defaultSource})`}
                value={
                  detail.shipping.defaultSource === 'unknown'
                    ? '—'
                    : fmt(detail.shipping.defaultShippingCost, detail.currency)
                }
              />
            </div>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                Shipping cost override
                {!sameCcy && (
                  <span className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-mono normal-case tracking-normal">
                    {cogsCcy}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <MoneyInput
                  value={shippingOverride}
                  onValueChange={setShippingOverride}
                  decimals={currencyDecimals(cogsCcy)}
                  placeholder="blank = use default"
                  className="flex-1"
                />
                <span className="text-xs font-mono text-muted-foreground shrink-0">{cogsCcy}</span>
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Note (optional)
              </span>
              <input
                type="text"
                placeholder="e.g. comp shipment / GoBear courier"
                value={shippingNote}
                onChange={(e) => setShippingNote(e.target.value)}
                className="w-full h-9 border border-input bg-input/30 rounded-md px-3 text-sm"
              />
            </label>
          </CardContent>
        </Card>
      </section>

      <DialogFooter className="flex-row sm:justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
          <RotateCcw className="size-3.5" />
          Clear all overrides
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending} className="gap-1.5">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save overrides
        </Button>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
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
