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

  const exportXlsx = () => {
    const header = ['Zone', 'Nước', ...card.tiers.map((t) => `≤${t}kg`)];
    const rows = card.zones.map((z) => {
      const byTier = new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd]));
      return {
        Zone: z.label,
        'Nước': z.countries.join(', '),
        ...Object.fromEntries(card.tiers.map((t) => [`≤${t}kg`, byTier.get(t) ?? ''])),
      };
    });
    const ws = utils.json_to_sheet(rows, { header });
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Rate card');
    const notes = card.surchargeNotes.map((n) => [n]);
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Phụ phí (FedEx tính khi bill)'], ...notes, [], ['Fuel', fuelUrl]]), 'Ghi chú');
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

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="[&>th]:text-left [&>th]:p-2 [&>th]:whitespace-nowrap">
              <th>Zone</th><th>Nước</th>
              {card.tiers.map((t) => <th key={t} className="text-right">≤{t}kg</th>)}
            </tr>
          </thead>
          <tbody>
            {card.zones.map((z) => {
              const byTier = new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd]));
              return (
                <tr key={z.label} className="border-b [&>td]:p-2 align-top">
                  <td className="font-medium whitespace-nowrap">{z.label}</td>
                  <td className="text-muted-foreground max-w-xs">{z.countries.join(', ')}</td>
                  {card.tiers.map((t) => (
                    <td key={t} className="text-right whitespace-nowrap">{byTier.has(t) ? vnd(byTier.get(t)!) : '—'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-sm space-y-1">
        <div className="font-medium">Phụ phí (FedEx tính theo công thức của hãng khi xuất bill):</div>
        <ul className="list-disc pl-5 text-muted-foreground">
          {card.surchargeNotes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <p>Phụ phí xăng dầu FedEx: <a className="text-blue-600 underline" href={fuelUrl} target="_blank" rel="noopener noreferrer">{fuelUrl}</a></p>
      </div>
    </div>
  );
}
