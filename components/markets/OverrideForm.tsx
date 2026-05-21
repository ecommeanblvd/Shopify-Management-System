'use client';

import { useState } from 'react';
import type {
  Market, MarketStoreOverride, ShippingZone, ShippingRate, MarketShipping, MarketPriceAdjustment,
} from '@/features/markets/types';

interface Props {
  market: Market;
  storeId: string;
  storeName: string;
  initial: MarketStoreOverride;
  onSubmit: (o: MarketStoreOverride) => Promise<void>;
}

export function OverrideForm({ market, storeId, storeName, initial, onSubmit }: Props) {
  const [adj, setAdj] = useState<MarketPriceAdjustment | null>(initial.priceAdjustment);
  const [shipping, setShipping] = useState<MarketShipping | null>(initial.shipping);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addZone() {
    const name = prompt('Zone name?');
    if (!name) return;
    setShipping({
      zones: { ...(shipping?.zones ?? {}), [name]: { countries: [], rates: {} } },
    });
  }

  function removeZone(name: string) {
    if (!shipping) return;
    const { [name]: _gone, ...rest } = shipping.zones;
    setShipping(Object.keys(rest).length === 0 ? null : { zones: rest });
  }

  function updateZone(name: string, patch: Partial<ShippingZone>) {
    if (!shipping) return;
    setShipping({
      zones: { ...shipping.zones, [name]: { ...shipping.zones[name], ...patch } },
    });
  }

  function addRate(zoneName: string) {
    const name = prompt('Rate name?');
    if (!name) return;
    updateZone(zoneName, {
      rates: {
        ...shipping!.zones[zoneName].rates,
        [name]: { type: 'flat', price: 0, currency: market.primaryCurrency },
      },
    });
  }

  function updateRate(zoneName: string, rateName: string, patch: Partial<ShippingRate>) {
    updateZone(zoneName, {
      rates: {
        ...shipping!.zones[zoneName].rates,
        [rateName]: { ...shipping!.zones[zoneName].rates[rateName], ...patch },
      },
    });
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit({
            storeId, marketHandle: market.handle,
            priceAdjustment: adj, shipping,
          });
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-8"
    >
      <p className="text-sm text-muted-foreground">
        Store: <strong>{storeName}</strong> · Market: <strong>{market.name}</strong>
      </p>

      <section>
        <h2 className="text-lg font-medium mb-3">Price adjustment</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={adj !== null}
            onChange={(e) => setAdj(e.target.checked ? { type: 'percentage', value: 0 } : null)}
          />
          Enable price adjustment
        </label>
        {adj && (
          <label className="block mt-3">
            <span className="text-sm">Percentage (-50 to +200)</span>
            <input
              type="number"
              value={adj.value}
              min={-50}
              max={200}
              onChange={(e) => setAdj({ type: 'percentage', value: Number(e.target.value) })}
              className="mt-1 block w-40 rounded border px-3 py-2"
            />
          </label>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3 flex items-center justify-between">
          Shipping zones
          <button
            type="button"
            onClick={addZone}
            className="text-sm text-primary hover:underline"
          >
            + Add zone
          </button>
        </h2>
        {!shipping || Object.keys(shipping.zones).length === 0 ? (
          <p className="text-sm text-muted-foreground">No shipping zones configured.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(shipping.zones).map(([zoneName, zone]) => (
              <div key={zoneName} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">{zoneName}</h3>
                  <button
                    type="button"
                    onClick={() => removeZone(zoneName)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove zone
                  </button>
                </div>
                <label className="block mb-3">
                  <span className="text-sm">Countries (ISO-2, comma)</span>
                  <input
                    type="text"
                    value={zone.countries.join(', ')}
                    onChange={(e) => updateZone(zoneName, {
                      countries: e.target.value.split(',')
                        .map((s) => s.trim().toUpperCase()).filter(Boolean),
                    })}
                    className="mt-1 block w-full rounded border px-3 py-2 text-sm"
                    placeholder={market.countries.join(', ')}
                  />
                </label>
                <div className="space-y-2">
                  {Object.entries(zone.rates).map(([rateName, rate]) => (
                    <div key={rateName} className="flex items-center gap-2 text-sm">
                      <span className="w-32 font-mono">{rateName}</span>
                      <input
                        type="number"
                        value={rate.price}
                        onChange={(e) => updateRate(zoneName, rateName, { price: Number(e.target.value) })}
                        className="w-24 rounded border px-2 py-1"
                      />
                      <input
                        type="text"
                        value={rate.currency}
                        onChange={(e) => updateRate(zoneName, rateName, { currency: e.target.value.toUpperCase() })}
                        className="w-20 rounded border px-2 py-1 font-mono"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addRate(zoneName)}
                    className="text-xs text-primary hover:underline"
                  >
                    + Add rate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary text-primary-foreground px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save override'}
      </button>
    </form>
  );
}
