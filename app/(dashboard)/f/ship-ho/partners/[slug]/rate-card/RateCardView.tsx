'use client';

import { utils, writeFile } from 'xlsx';
import { Button } from '@/components/ui/button';
import { MIN_MARKUP_PERCENT } from '@/features/ship-ho/offer-pricing';
import type { RateCard } from '@/features/ship-ho/offer-ratecard-logic';

const vnd = (v: number) => v.toLocaleString('vi-VN') + ' ₫';

export function RateCardView({ card, partnerSlug, accountName, fuelUrl }: {
  card: RateCard; partnerSlug: string; accountName: string; fuelUrl: string;
}) {
  const below = card.markupPercent < MIN_MARKUP_PERCENT;
  const isEmpty = card.zones.length === 0 || card.zones.every((z) => z.cells.length === 0);

  const exportXlsx = () => {
    // Sheet 1: bảng giá thuần Zone × tier (không cột nước) — trình bày như rate card hãng.
    const rateHeader = ['Zone', ...card.tiers.map((t) => `≤${t}kg`)];
    const rateRows = card.zones.map((z) => {
      const byTier = new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd]));
      return {
        Zone: z.label,
        ...Object.fromEntries(card.tiers.map((t) => [`≤${t}kg`, byTier.get(t) ?? ''])),
      };
    });
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.json_to_sheet(rateRows, { header: rateHeader }), 'Bảng giá');
    // Sheet 2: bảng zone quốc gia kiểu carrier — 1 dòng / nước, sort theo tên.
    const countryZoneRows = card.countryZones.map((cz) => ({ 'Quốc gia': `${cz.name} (${cz.code})`, Zone: cz.zone }));
    utils.book_append_sheet(wb, utils.json_to_sheet(countryZoneRows, { header: ['Quốc gia', 'Zone'] }), 'Zone quốc gia');
    const notes = card.surcharges.map((s) => [s.label, s.detail]);
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Phụ phí (FedEx tính khi bill)', ''], ...notes, [], ['Fuel', fuelUrl]]), 'Ghi chú');
    writeFile(wb, `rate-card-${partnerSlug}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 print:hidden">
        <span className="text-sm text-muted-foreground">Nguồn: {accountName} · markup {card.markupPercent}%</span>
        {below && <span className="rounded bg-red-100 text-red-700 text-xs px-1.5 py-0.5">⚠ &lt; {MIN_MARKUP_PERCENT}%</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportXlsx}>Export XLSX</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>Export PDF</Button>
        </div>
      </div>

      {isEmpty ? (
        <div className="rounded border border-amber-400 bg-amber-50 text-amber-900 text-sm p-3">
          ⚠ Không tạo được giá — bảng giá FedEx không ở VND hoặc thiếu rate.
        </div>
      ) : (
        <>
          {/* Bảng 1: giá thuần Zone × tier — trình bày như rate card hãng vận chuyển. */}
          <div className="text-sm font-medium">Bảng giá</div>
          <div className="border rounded overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="[&>th]:text-left [&>th]:p-2 [&>th]:whitespace-nowrap">
                  <th>Zone</th>
                  {card.tiers.map((t) => <th key={t} className="text-right">≤{t}kg</th>)}
                </tr>
              </thead>
              <tbody>
                {card.zones.map((z) => {
                  const byTier = new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd]));
                  return (
                    <tr key={z.label} className="border-b [&>td]:p-2 align-top">
                      <td className="font-medium whitespace-nowrap">{z.label}</td>
                      {card.tiers.map((t) => (
                        <td key={t} className="text-right whitespace-nowrap">{byTier.has(t) ? vnd(byTier.get(t)!) : '—'}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bảng 2: zone quốc gia kiểu carrier — alphabet, nhiều cột, "Tên (CC) — Zone". */}
          <div className="text-sm font-medium">Bảng zone quốc gia</div>
          <div className="border rounded p-3">
            <div className="text-sm columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-x-6">
              {card.countryZones.map((cz) => (
                <div key={cz.code} className="flex justify-between gap-2 py-0.5 break-inside-avoid">
                  <span className="whitespace-nowrap">{cz.name} ({cz.code})</span>
                  <span className="text-muted-foreground whitespace-nowrap">{cz.zone}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="text-sm space-y-1">
        <div className="font-medium">Phụ phí (FedEx tính theo công thức của hãng khi xuất bill):</div>
        <ul className="list-disc pl-5 text-muted-foreground">
          {card.surcharges.map((s) => (
            <li key={s.label}><span className="font-medium text-foreground">{s.label}</span> — {s.detail}</li>
          ))}
        </ul>
        <p>Phụ phí xăng dầu FedEx: <a className="text-blue-600 underline" href={fuelUrl} target="_blank" rel="noopener noreferrer">{fuelUrl}</a></p>
      </div>
    </div>
  );
}
