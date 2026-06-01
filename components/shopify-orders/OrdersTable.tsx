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
  AlertCircle, ExternalLink,
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
  }) => Promise<{ linesUpdated: number; shippingUpdated: boolean }>;
}

export function OrdersTable({
  orders, canEdit, costCurrency, fxRate, getDetailAction, saveAction,
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

  // Tally unpriced shipments by reason so the operator can see at a
  // glance which root cause is biting (set weights? add a market?).
  // Counts the FILTERED set so vendor/search narrows the diagnostic.
  const unpriced = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const o of filtered) {
      if (o.shippingCostSource !== 'unknown') continue;
      total += 1;
      const key = o.shippingCostReason ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return { total, counts };
  }, [filtered]);

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
                <th className="text-right px-3 py-2">GMV</th>
                <th className="text-right px-3 py-2">Refunded</th>
                <th className="text-right px-3 py-2">Discount</th>
                <th className="text-right px-3 py-2">Ship rev</th>
                <th className="text-right px-3 py-2">
                  Ship cost
                  {showShipInCostCurrency && (
                    <span
                      className="ml-1 px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-mono normal-case tracking-normal"
                      title={`Displayed in ${costCurrency} at FX ${fxRate!.toLocaleString()}. Revenue still subtracts in ${orders[0]?.currency ?? 'order currency'}.`}
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
                      <span
                        className="text-amber-600 dark:text-amber-400 cursor-help underline decoration-dotted underline-offset-2"
                        title={reasonLabel(o.shippingCostReason)}
                      >
                        —
                      </span>
                    ) : showShipInCostCurrency ? (
                      // Use the raw cost-currency value computed directly
                      // from the rate sheet / invoice / override — no
                      // USD→VND round-trip, so the number matches what the
                      // carrier will actually invoice down to the integer.
                      <span
                        title={`${o.shippingCostSource} · ${fmt(o.shippingCost, o.currency)} in order currency`}
                      >
                        {fmt(o.shippingCostRaw, o.shippingCostRawCurrency || costCurrency!)}
                      </span>
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

            {/* Diagnostic panel — only when the engine couldn't price this
                shipment. Surfaces the EXACT missing input (country, weight,
                market, link, or carrier zone match) plus a deep link to
                the page where the operator can fix it. */}
            {detail.shipping.defaultSource === 'unknown' && (
              <UnknownShippingDiagnostic
                reason={detail.shipping.defaultUnknownReason}
                shipCountry={detail.shipCountry}
                shipWeightKg={detail.shipWeightKg}
              />
            )}
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

/**
 * Operator-facing explanation for a `shippingCostSource === 'unknown'`
 * row. Keep these short — they render inside a native `title` tooltip.
 */
interface UnknownShippingDiagnosticProps {
  reason: OrderRow['shippingCostReason'];
  shipCountry: string | null;
  shipWeightKg: number | null;
}

/**
 * Full-width amber panel shown inside the order edit modal when the
 * engine couldn't quote this shipment. Surfaces:
 *
 *   - what the order's actual ship-to + weight values look like (so
 *     "no weight" is obviously a Shopify variant fix, not a system bug)
 *   - the single sentence cause + fix
 *   - a deep link to the page where the operator goes to fix it
 *
 * The deep links are deliberately generic — Markets and Carriers
 * landing pages — rather than hand-built deep-deep links to specific
 * rows, since the right row to edit depends on context (which market
 * to extend, which carrier zone to add the country to).
 */
function UnknownShippingDiagnostic({
  reason, shipCountry, shipWeightKg,
}: UnknownShippingDiagnosticProps) {
  const country = shipCountry ?? null;
  const weight = shipWeightKg !== null && shipWeightKg > 0 ? shipWeightKg : null;

  const fix = getUnknownShippingFix(reason, country);

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Can&rsquo;t compute shipping cost yet
          </div>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80 leading-relaxed">
            {reasonLabel(reason)}
          </p>

          {/* What the system actually sees on this order — helps spot
              the gap fast (a missing country/weight is immediately
              actionable; a present one points at config). */}
          <div className="text-[11px] font-mono tabular-nums text-amber-900/70 dark:text-amber-200/70 flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
            <span>
              Ship to: <span className="font-medium">{country ?? '—'}</span>
            </span>
            <span>
              Weight: <span className="font-medium">{weight !== null ? `${weight.toFixed(3)} kg` : '—'}</span>
            </span>
          </div>

          {fix.href && (
            <div className="pt-1">
              <a
                href={fix.href}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2"
              >
                {fix.label}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Where to send the operator to fix this specific cause. `null` href
 * means there's no in-app fix (`no_country` is a Shopify-side data
 * issue we can't link directly to from here).
 */
function getUnknownShippingFix(
  reason: OrderRow['shippingCostReason'],
  shipCountry: string | null,
): { label: string; href: string | null } {
  switch (reason) {
    case 'no_country':
      return { label: 'Check order in Shopify admin', href: null };
    case 'no_weight':
      return { label: 'Open Shopify products to set variant weights', href: null };
    case 'no_market':
      return {
        label: shipCountry ? `Add ${shipCountry} to a market` : 'Open Markets',
        href: '/f/markets',
      };
    case 'no_carrier_link':
      return {
        label: shipCountry ? `Link a carrier to a market covering ${shipCountry}` : 'Open Markets',
        href: '/f/markets',
      };
    case 'no_carrier_accounts':
      return {
        label: 'Add a carrier account to start pricing',
        href: '/f/carrier-rates/new',
      };
    case 'no_quote':
      return {
        label: shipCountry ? `Extend carrier zones/tiers for ${shipCountry}` : 'Open carrier rates',
        href: '/f/carrier-rates',
      };
    default:
      return { label: 'Open Markets', href: '/f/markets' };
  }
}

/**
 * Compact 1-2 word label for the diagnostic chip strip. The full
 * sentence lives in `reasonLabel` on hover.
 */
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
