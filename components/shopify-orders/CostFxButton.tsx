'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { currencyDecimals } from '@/lib/currency-format';
import { Coins, Save } from 'lucide-react';

interface CostFxButtonProps {
  storeId: string;
  orderCurrency: string;
  initialCostCurrency: string | null;
  initialFxRate: string | null;
  initialPackagingFee: string | null;
  saveAction: (input: {
    storeId: string; costCurrency: string; fxRate: string; packagingFee: string;
  }) => Promise<void>;
}

/**
 * Header chip that surfaces the brand's COGs currency + FX rate against
 * the order currency. Click → modal to set both. Once set, the metrics
 * pipeline divides COGs by the FX rate before subtracting from revenue
 * (so a Mirer order in USD whose SKU costs 180,000 VND with rate 24000
 * is treated as $7.50 of COGs, not $180,000).
 */
export function CostFxButton({
  storeId, orderCurrency, initialCostCurrency, initialFxRate, initialPackagingFee, saveAction,
}: CostFxButtonProps) {
  const [open, setOpen] = useState(false);
  const [costCurrency, setCostCurrency] = useState(initialCostCurrency ?? '');
  const [fxRate, setFxRate] = useState(initialFxRate ?? '');
  const [packagingFee, setPackagingFee] = useState(initialPackagingFee ?? '');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onSave = (): void => {
    startTransition(async () => {
      await saveAction({ storeId, costCurrency, fxRate, packagingFee });
      setOpen(false);
      router.refresh(); // re-fetch server components → giá VND hiện ngay, không cần F5.
    });
  };

  const fxLabel = initialCostCurrency && initialFxRate
    ? `${initialCostCurrency} @ ${Number(initialFxRate).toLocaleString()}`
    : null;
  const packagingLabel = initialPackagingFee
    ? `+${Number(initialPackagingFee)}/${orderCurrency}`
    : null;
  const summary = fxLabel
    ? `Cost: ${fxLabel}${packagingLabel ? ` · pkg ${packagingLabel}` : ''}`
    : 'Cost FX';

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-2 px-2.5 text-xs"
        title="Brand cost-of-goods currency + FX rate to the order currency"
      >
        <Coins className="size-3.5" />
        {summary}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="size-4" />
              Brand COGs currency
            </DialogTitle>
            <DialogDescription>
              Some brands invoice in a currency different from the order currency
              (e.g. Mirer pays suppliers in <span className="font-mono">VND</span> for orders
              that settle in <span className="font-mono">{orderCurrency || 'USD'}</span>). Set
              the COGs currency and the FX rate; the dashboard will convert every COGs number
              (CSV uploads + per-line overrides) into the order currency before subtracting
              from revenue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Cost currency (ISO-3)
              </span>
              <select
                value={costCurrency}
                onChange={(e) => setCostCurrency(e.target.value)}
                className="w-full h-9 border border-input bg-input/30 rounded-md px-3 text-sm font-mono"
              >
                <option value="">— Theo tiền đơn ({orderCurrency || 'USD'}) —</option>
                <option value="USD">USD</option>
                <option value="VND">VND</option>
                {costCurrency !== '' && costCurrency !== 'USD' && costCurrency !== 'VND' && (
                  <option value={costCurrency}>{costCurrency}</option>
                )}
              </select>
              <span className="block text-[11px] text-muted-foreground">
                Để trống = coi mọi giá vốn đã ở tiền của đơn.
              </span>
            </label>

            <label className="block space-y-1 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                FX rate
              </span>
              <MoneyInput
                value={fxRate}
                onValueChange={setFxRate}
                /* FX rates can need 4 decimals (e.g. 0.0426 for VND→USD).
                   We treat them as money-like since the magnitude often
                   spans 5+ digits where separators matter most. */
                decimals={4}
                placeholder="e.g. 24000 (1 USD = 24,000 VND)"
              />
              <span className="block text-[11px] text-muted-foreground">
                How many <span className="font-mono">{costCurrency || 'cost-currency'}</span> units equal 1
                {' '}<span className="font-mono">{orderCurrency || 'order-currency'}</span> unit.
              </span>
            </label>

            <label className="block space-y-1 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Packaging fee / order
              </span>
              <div className="flex items-center gap-2">
                <MoneyInput
                  value={packagingFee}
                  onValueChange={setPackagingFee}
                  decimals={currencyDecimals(orderCurrency)}
                  placeholder="e.g. 5 (USD per order)"
                  className="flex-1"
                />
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {orderCurrency || 'USD'}
                </span>
              </div>
              <span className="block text-[11px] text-muted-foreground">
                Boxes, labels, fulfilment labour — added to every order&apos;s shipping
                cost. In the order currency, NOT the cost currency.
              </span>
            </label>
          </div>

          <DialogFooter className="flex-row sm:justify-between gap-2 pt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={pending} className="gap-1.5">
              <Save className="size-3.5" />
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
