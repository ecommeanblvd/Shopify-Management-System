'use client';

import { utils, writeFile } from 'xlsx';
import { Button } from '@/components/ui/button';
import type { RateCard } from '@/features/ship-ho/offer-ratecard-logic';

const vnd = (v: number) => v.toLocaleString('vi-VN') + ' ₫';

export function RateCardView({ card, partnerSlug, accountName, fuelUrl, odaLookupUrl }: {
  card: RateCard; partnerSlug: string; accountName: string; fuelUrl: string; odaLookupUrl: string;
}) {
  const isEmpty = card.zones.length === 0 || card.zones.every((z) => z.cells.length === 0);

  // Lookup dùng chung cho cả bảng hiển thị và XLSX: mỗi zone 1 Map tierUpperKg→offerVnd.
  const zoneTierMaps = card.zones.map((z) => new Map(z.cells.map((c) => [c.tierUpperKg, c.offerVnd])));

  const exportXlsx = () => {
    // Sheet 1: bảng giá xoay — cột đầu = mốc cân, mỗi zone 1 cột (trình bày như rate card hãng).
    const rateHeader = ['Cân', ...card.zones.map((z) => z.label)];
    const rateRows = card.tiers.map((t) => ({
      'Cân': `≤${t}kg`,
      ...Object.fromEntries(card.zones.map((z, i) => [z.label, zoneTierMaps[i].get(t) ?? ''])),
    }));
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.json_to_sheet(rateRows, { header: rateHeader }), 'Bảng giá');
    // Sheet 2: bảng zone quốc gia kiểu carrier — 1 dòng / nước, sort theo tên.
    const countryZoneRows = card.countryZones.map((cz) => ({ 'Quốc gia': `${cz.name} (${cz.code})`, Zone: cz.zone }));
    utils.book_append_sheet(wb, utils.json_to_sheet(countryZoneRows, { header: ['Quốc gia', 'Zone'] }), 'Zone quốc gia');
    const notes = card.surcharges.map((s) => {
      const detail = s.kind === 'remote_fixed' ? `${s.detail} · ODA tier lookup: ${odaLookupUrl}` : s.detail;
      return [s.label, detail];
    });
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Phụ phí (FedEx tính khi bill)', ''], ...notes, [], ['Fuel', fuelUrl]]), 'Ghi chú');
    writeFile(wb, `rate-card-${partnerSlug}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 print:hidden">
        <span className="text-sm text-muted-foreground">Nguồn: {accountName} · markup hiệu dụng theo tier: {card.markupPercent}%</span>
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
          {/* Bảng 1: giá xoay — cột đầu = mốc cân, mỗi zone 1 cột — trình bày như rate card hãng vận chuyển. */}
          <div className="text-sm font-medium">Bảng giá</div>
          <div className="border rounded overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="[&>th]:text-left [&>th]:p-2 [&>th]:whitespace-nowrap">
                  <th>Cân</th>
                  {card.zones.map((z) => <th key={z.label} className="text-right">{z.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {card.tiers.map((t) => (
                  <tr key={t} className="border-b [&>td]:p-2 align-top">
                    <td className="font-medium text-left whitespace-nowrap">≤{t}kg</td>
                    {card.zones.map((z, i) => (
                      <td key={z.label} className="text-right whitespace-nowrap">
                        {zoneTierMaps[i].has(t) ? vnd(zoneTierMaps[i].get(t)!) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
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
          {card.surcharges.map((s, i) => (
            <li key={`${s.kind}-${i}`}>
              <span className="font-medium text-foreground">{s.label}</span> — {s.detail}
              {s.kind === 'remote_fixed' && (
                <> · <a className="text-blue-600 underline" href={odaLookupUrl}>Tra tier theo zip/tỉnh</a></>
              )}
            </li>
          ))}
        </ul>
        <p>Phụ phí xăng dầu FedEx: <a className="text-blue-600 underline" href={fuelUrl} target="_blank" rel="noopener noreferrer">{fuelUrl}</a></p>
      </div>
    </div>
  );
}
