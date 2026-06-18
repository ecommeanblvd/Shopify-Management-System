'use client';

import { useMemo, useState } from 'react';
import { Save, Trash2, Power, Check, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MoneyInputField } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface SurchargeEditDialogProps {
  triggerLabel: string;
  /** Dialog header — name of the kind (e.g. "Edit fuel surcharge"). */
  title: string;
  /** What this kind means — shown under the title. */
  description: string;
  /** Suffix on the value input, e.g. "%", "VND", "VND/kg". */
  unitSuffix: string;
  /** Optional per-kg companion suffix, e.g. "VND/kg" when valuePerKgVisible is true. */
  perKgUnitSuffix?: string;
  defaultValue: string;
  defaultPerKgValue?: string | null;
  defaultNote: string;
  defaultActive: boolean;
  /** Tier label to show as a read-only chip (when present). */
  tier?: string | null;
  /** Whether to render the per-kg input. Only true for remote_fixed with max-of-two semantics. */
  perKgVisible?: boolean;
  /** When set, the value input becomes a MoneyInput with this many decimals
   *  (thousand-separator display). Leave undefined for percent / dimensionless
   *  surcharges where separators would be confusing. */
  valueDecimals?: number;
  /** Same as valueDecimals, for the per-kg companion. */
  perKgDecimals?: number;
  /** Show the country-code list input. Only true for `demand_per_kg`
   *  (FedEx Demand Surcharge). The input accepts a comma- or
   *  whitespace-separated list of ISO-2 codes (e.g. "VN, TH, MY"). */
  countriesVisible?: boolean;
  defaultCountryCodes?: string[] | null;
  /** Served-country options for the country-scope multi-select. When non-empty
   *  (and `countriesVisible`), the free-text ISO box is replaced by a
   *  searchable multi-select. When undefined/empty, falls back to free text. */
  countryOptions?: { iso: string; name: string }[];
  /** Effective-from date (ISO `YYYY-MM-DD`) to pre-fill on edit. Add mode
   *  defaults to today. */
  defaultStartsAt?: string;
  /** Server action: applied on Save. Form data carries value/note/active. */
  saveAction: (formData: FormData) => void | Promise<void>;
  /** Server action: applied on Remove. When undefined, the Remove button is hidden (add mode). */
  deleteAction?: () => void | Promise<void>;
  /** Trigger render override — e.g. an icon button or a full-width "Add" card. */
  triggerVariant?: 'outline-sm' | 'ghost-add-row';
  /**
   * Surcharge kind — used to conditionally render kind-specific fields.
   * When 'addon_fixed', shows the apply-mode selector.
   */
  kind?: string;
  /** Default apply mode for addon_fixed rows. */
  defaultApplyMode?: 'always' | 'when_billed';
  /** Nước MIỄN (ISO-2) cho addon_fixed — row không áp dụng ở các nước này. */
  defaultExcludedCountryCodes?: string[] | null;
}

export function SurchargeEditDialog({
  triggerLabel, title, description, unitSuffix, perKgUnitSuffix, defaultValue, defaultPerKgValue,
  defaultNote, defaultActive, tier, perKgVisible, valueDecimals, perKgDecimals,
  countriesVisible, defaultCountryCodes, countryOptions, defaultStartsAt,
  saveAction, deleteAction,
  triggerVariant = 'outline-sm',
  kind, defaultApplyMode = 'always', defaultExcludedCountryCodes,
}: SurchargeEditDialogProps) {
  const [open, setOpen] = useState(false);

  // Country-scope multi-select state. Only used when `countriesVisible` AND
  // `countryOptions` is non-empty; otherwise we fall back to the free-text box.
  const hasCountryPicker = !!countriesVisible && !!countryOptions && countryOptions.length > 0;
  const [selectedCountries, setSelectedCountries] = useState<string[]>(
    () => (defaultCountryCodes ?? []).map((c) => c.toUpperCase()),
  );
  const [countryQuery, setCountryQuery] = useState('');

  // Today as YYYY-MM-DD for the effective-from default on Add.
  const todayISO = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const optionByIso = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of countryOptions ?? []) m.set(o.iso.toUpperCase(), o.name);
    return m;
  }, [countryOptions]);

  const filteredOptions = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    const opts = countryOptions ?? [];
    if (!q) return opts;
    return opts.filter(
      (o) => o.name.toLowerCase().includes(q) || o.iso.toLowerCase().includes(q),
    );
  }, [countryOptions, countryQuery]);

  function toggleCountry(iso: string) {
    const up = iso.toUpperCase();
    setSelectedCountries((prev) =>
      prev.includes(up) ? prev.filter((c) => c !== up) : [...prev, up],
    );
  }

  return (
    <>
      {triggerVariant === 'ghost-add-row' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors rounded-lg border border-dashed border-border px-3 py-2"
        >
          + {triggerLabel}
        </button>
      ) : (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
          {triggerLabel}
        </Button>
      )}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {tier && (
              <Badge variant="secondary" className="h-5 text-[10px] uppercase tracking-wider">
                {tier}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          action={async (formData) => {
            await saveAction(formData);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Value
            </Label>
            <div className="flex items-center gap-2">
              {valueDecimals !== undefined ? (
                <MoneyInputField
                  name="value"
                  defaultValue={defaultValue}
                  decimals={valueDecimals}
                  required
                  className="flex-1"
                />
              ) : (
                <Input
                  name="value"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  defaultValue={defaultValue}
                  className="font-mono tabular-nums"
                  required
                />
              )}
              <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">{unitSuffix}</span>
            </div>
          </div>

          {perKgVisible && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Per-kg companion (optional)
              </Label>
              <div className="flex items-center gap-2">
                {perKgDecimals !== undefined ? (
                  <MoneyInputField
                    name="valuePerKg"
                    defaultValue={defaultPerKgValue ?? ''}
                    decimals={perKgDecimals}
                    placeholder="leave blank for flat-only"
                    className="flex-1"
                  />
                ) : (
                  <Input
                    name="valuePerKg"
                    defaultValue={defaultPerKgValue ?? ''}
                    placeholder="leave blank for flat-only"
                    className="font-mono tabular-nums"
                  />
                )}
                <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">{perKgUnitSuffix}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                When set, the engine applies <span className="font-mono">max(value, perKg × weight)</span>.
                Leave empty for a flat per-shipment fee.
              </p>
            </div>
          )}

          {countriesVisible && hasCountryPicker && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Country scope
              </Label>
              {/* Submitted value — comma-joined ISO codes. Empty = all destinations. */}
              <input type="hidden" name="countryCodes" value={selectedCountries.join(',')} />

              {/* Selected chips */}
              {selectedCountries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedCountries.map((iso) => (
                    <span
                      key={iso}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
                    >
                      <span>{optionByIso.get(iso) ?? iso}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{iso}</span>
                      <button
                        type="button"
                        onClick={() => toggleCountry(iso)}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                        aria-label={`Remove ${iso}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search box */}
              <Input
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="Search country or ISO code…"
                className="text-xs"
              />

              {/* Scrollable option list */}
              <div className="max-h-40 overflow-auto rounded-md border border-border">
                {filteredOptions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground italic">
                    No matching country.
                  </div>
                ) : (
                  filteredOptions.map((o) => {
                    const iso = o.iso.toUpperCase();
                    const checked = selectedCountries.includes(iso);
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => toggleCountry(iso)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50"
                      >
                        <span
                          className={
                            'flex size-4 shrink-0 items-center justify-center rounded border ' +
                            (checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input')
                          }
                        >
                          {checked && <Check className="size-3" />}
                        </span>
                        <span className="flex-1 truncate">{o.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{iso}</span>
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Engine applies this surcharge only when the order&rsquo;s ship-to
                country is selected. Leave empty to apply to every destination.
              </p>
            </div>
          )}

          {countriesVisible && !hasCountryPicker && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Country scope (ISO-2 codes)
              </Label>
              <Input
                name="countryCodes"
                defaultValue={(defaultCountryCodes ?? []).join(', ')}
                placeholder="e.g. VN, TH, MY, ID  —  leave blank for all destinations"
                className="font-mono uppercase tracking-widest text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Engine applies this surcharge only when the order&rsquo;s ship-to
                country is in this list. Leave blank to apply to every
                destination. Separate with commas, spaces, or new lines.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Note (optional)
            </Label>
            <Input name="note" defaultValue={defaultNote} placeholder="e.g. Premium 9:00 service" />
          </div>

          {(kind === 'addon_fixed' || kind === 'country_fixed') && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Chế độ áp dụng
              </Label>
              <select
                name="applyMode"
                defaultValue={defaultApplyMode}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="always">Luôn cộng vào quote</option>
                <option value="when_billed">Chỉ kiểm khi bill có</option>
              </select>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Luôn cộng</span>: engine cộng vào mọi quote.{' '}
                <span className="font-medium">Chỉ kiểm khi bill có</span>: không vào quote — chỉ làm giá tham chiếu đối soát (FedEx US import handling, Direct Signature).
              </p>
            </div>
          )}

          {kind === 'addon_fixed' && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Nước miễn (ISO-2)
              </Label>
              <Input
                name="excludedCountryCodes"
                defaultValue={(defaultExcludedCountryCodes ?? []).join(', ')}
                placeholder="VD: SA, QA, IL — bỏ trống nếu áp dụng mọi nước"
                className="font-mono uppercase tracking-widest text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Phí KHÔNG áp dụng khi nước đích nằm trong danh sách này
                (FedEx miễn Direct Signature cho 13 nước).
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Ngày hiệu lực (effective from)
            </Label>
            <Input
              name="startsAt"
              type="date"
              defaultValue={defaultStartsAt ?? todayISO}
              className="font-mono tabular-nums"
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <div className="text-sm">
              <div className="font-medium flex items-center gap-2">
                <Power className={'size-3.5 ' + (defaultActive ? 'text-emerald-500' : 'text-muted-foreground')} />
                {defaultActive ? 'Active' : 'Inactive'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Active surcharges fold into every quote. Disabled ones are skipped.
              </div>
            </div>
            <input
              type="checkbox"
              name="active"
              value="true"
              defaultChecked={defaultActive}
              className="size-5 accent-primary"
            />
          </label>

          <DialogFooter className="gap-2 sm:gap-2">
            {deleteAction && (
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                formAction={async () => { await deleteAction(); setOpen(false); }}
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="gap-1.5">
              <Save className="size-3.5" />
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
