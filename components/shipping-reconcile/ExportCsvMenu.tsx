'use client';

import { useEffect, useRef, useState } from 'react';
import {
  presetRange, describeRange, PRESET_LABELS, type ExportPreset,
} from '@/features/shipments/export-range';

const PRESETS: ExportPreset[] = ['this_month', 'last_month', 'last_30d', 'all', 'custom'];

/**
 * Nút Export CSV kèm chọn khoảng NGÀY SHIP (CEO 12/08): preset tháng này /
 * tháng trước / 30 ngày qua / tất cả, hoặc tự chọn 2 mốc. Carrier + country
 * lấy theo bộ lọc đang xem trên trang.
 */
export function ExportCsvMenu({ carrier, country }: { carrier?: string; country?: string }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<ExportPreset>('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài / Esc → đóng (menu che bảng nếu để mở).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const range = presetRange(preset, new Date(), { from, to });
  const href = (() => {
    const p = new URLSearchParams();
    if (carrier && carrier !== 'all') p.set('carrier', carrier);
    if (country) p.set('country', country);
    p.set('preset', preset);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    return `/f/shipping-reconcile/export.csv?${p.toString()}`;
  })();

  const customIncomplete = preset === 'custom' && !range.from && !range.to;

  return (
    <div className="relative inline-block" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-border px-3 py-1 hover:bg-muted"
      >
        Export CSV ▾
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 space-y-3 rounded-lg border border-border bg-background p-3 shadow-xl">
          <div className="text-xs font-medium text-muted-foreground">Lọc theo NGÀY SHIP</div>

          <div className="space-y-1">
            {PRESETS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio" name="export-preset" value={p} checked={preset === p}
                  onChange={() => setPreset(p)}
                />
                <span>{PRESET_LABELS[p]}</span>
                {p !== 'custom' && p !== 'all' && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {describeRange(presetRange(p, new Date()))}
                  </span>
                )}
              </label>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">Từ ngày
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm" />
              </label>
              <label className="text-[11px] text-muted-foreground">Đến ngày
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm" />
              </label>
            </div>
          )}

          <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
            Sẽ tải: <b className="text-foreground">{describeRange(range)}</b>
            {(range.from || range.to) && <> · chỉ đơn đã có ngày ship</>}
          </div>

          {customIncomplete ? (
            <span className="block rounded bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground">
              Chọn ít nhất 1 mốc ngày
            </span>
          ) : (
            <a
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground transition hover:opacity-90"
            >
              ⤓ Tải CSV
            </a>
          )}
        </div>
      )}
    </div>
  );
}
