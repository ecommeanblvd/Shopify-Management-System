'use client';
import { useRouter } from 'next/navigation';
import { STAGE_LABELS_SEG, SLA_SEGMENTS, type SlaKey, type GroupBy, type StatGroup } from './seg-labels';
import { fmtDuration } from '@/features/lifecycle/display';

export interface StatsViewProps {
  groups: StatGroup[];
  sla: Record<SlaKey, number>;
  stores: Array<{ id: string; name: string | null }>;
  brands: string[];
  carriers: string[];
  active: { store: string; brand: string; carrier: string; from: string; to: string; by: GroupBy };
}

const GROUP_TABS: Array<{ by: GroupBy; label: string }> = [
  { by: 'none', label: 'Tổng' },
  { by: 'brand', label: 'Theo Brand' },
  { by: 'carrier', label: 'Theo Carrier' },
  { by: 'month', label: 'Theo Tháng' },
];

function tone(rate: number): string {
  if (rate >= 0.3) return 'text-red-600';
  if (rate >= 0.1) return 'text-amber-600';
  return 'text-emerald-600';
}

export function StatsView({ groups, sla, stores, brands, carriers, active }: StatsViewProps) {
  const router = useRouter();

  function apply(patch: Partial<typeof active>) {
    const next = { ...active, ...patch };
    const q = new URLSearchParams();
    if (next.store) q.set('store', next.store);
    if (next.brand) q.set('brand', next.brand);
    if (next.carrier) q.set('carrier', next.carrier);
    if (next.from) q.set('from', next.from);
    if (next.to) q.set('to', next.to);
    if (next.by && next.by !== 'none') q.set('by', next.by);
    router.push(`/f/lifecycle/stats?${q.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Bộ lọc */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Store</span>
          <select className="h-9 rounded-md border bg-background px-2" value={active.store}
            onChange={(e) => apply({ store: e.target.value })}>
            <option value="">Tất cả store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Brand</span>
          <select className="h-9 rounded-md border bg-background px-2" value={active.brand}
            onChange={(e) => apply({ brand: e.target.value })}>
            <option value="">Tất cả brand</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Carrier</span>
          <select className="h-9 rounded-md border bg-background px-2" value={active.carrier}
            onChange={(e) => apply({ carrier: e.target.value })}>
            <option value="">Tất cả carrier</option>
            {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Từ tháng</span>
          <input type="month" className="h-9 rounded-md border bg-background px-2" value={active.from}
            onChange={(e) => apply({ from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Đến tháng</span>
          <input type="month" className="h-9 rounded-md border bg-background px-2" value={active.to}
            onChange={(e) => apply({ to: e.target.value })} />
        </label>
      </div>

      {/* Tabs breakdown */}
      <div className="flex gap-2">
        {GROUP_TABS.map((t) => (
          <button key={t.by} onClick={() => apply({ by: t.by })}
            className={`px-3 py-1.5 rounded-md text-sm border ${active.by === t.by ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Bảng */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{active.by === 'none' ? '' : GROUP_TABS.find((t) => t.by === active.by)!.label}</th>
              <th className="px-3 py-2 text-right font-medium">Đơn</th>
              {SLA_SEGMENTS.map((seg) => (
                <th key={seg} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {STAGE_LABELS_SEG[seg]}<br /><span className="text-xs text-muted-foreground">SLA {fmtDuration(sla[seg])}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={SLA_SEGMENTS.length + 2} className="px-3 py-8 text-center text-muted-foreground">Không có dữ liệu.</td></tr>
            )}
            {groups.map((g) => (
              <tr key={g.key} className="border-t">
                <td className="px-3 py-2 font-medium">{g.key}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.orders}</td>
                {SLA_SEGMENTS.map((seg) => {
                  const st = g.perStage[seg];
                  return (
                    <td key={seg} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {st.n === 0 ? <span className="text-muted-foreground">—</span> : (
                        <>
                          <div>{fmtDuration(st.avgHrs)} <span className="text-muted-foreground">· {fmtDuration(st.medianHrs)}</span></div>
                          <div className={`text-xs ${tone(st.overdueRate)}`}>{Math.round(st.overdueRate * 100)}% trễ ({st.n})</div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Mỗi ô: trung bình · trung vị (số đơn có dữ liệu) + % đơn vượt SLA. &lt;10% xanh · 10–30% vàng · ≥30% đỏ.</p>
    </div>
  );
}
