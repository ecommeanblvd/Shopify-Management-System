'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createShipHoPartner, updateShipHoPartner, setPartnerTier } from '@/features/ship-ho/partners-actions';
import { SHIP_HO_TIERS, resolveTier, effectiveMarkupPercent } from '@/features/ship-ho/tier-pricing';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';

interface Partner {
  id: string; brandSlug: string; displayName: string | null;
  markupPercent: string; billingCycle: string; billingCurrency: string; status: string; note: string | null;
  strategic: boolean; tierCode: string; tierOverrideCode: string | null; lastMonthOrders: number;
}
interface Brand { slug: string; displayName: string | null }

const TIER_BADGE: Record<string, string> = {
  standard: 'bg-muted text-muted-foreground',
  bronze: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  silver: 'bg-slate-400/20 text-slate-700 dark:text-slate-300',
  gold: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
  platinum: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
};

export function PartnersManager({ partners, brands, canManage }: { partners: Partner[]; brands: Brand[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [brandSlug, setBrandSlug] = useState('');
  const [cycle, setCycle] = useState<'weekly' | 'monthly'>('monthly');
  const [err, setErr] = useState<string | null>(null);

  const add = () =>
    start(async () => {
      setErr(null);
      // markupPercent legacy — pricing thật đi theo tier; giữ 20 làm floor tham chiếu.
      const r = await createShipHoPartner({ brandSlug, markupPercent: '20', billingCycle: cycle, billingCurrency: 'VND' });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else setBrandSlug('');
    });

  const toggle = (p: Partner) =>
    start(async () => {
      await updateShipHoPartner(p.id, { status: p.status === 'active' ? 'inactive' : 'active' });
    });

  const setStrategic = (p: Partner, strategic: boolean) =>
    start(async () => { setErr(null); const r = await setPartnerTier(p.id, { strategic }); if (!r.ok) setErr(r.error ?? 'Lỗi'); });
  const setOverride = (p: Partner, code: string) =>
    start(async () => { setErr(null); const r = await setPartnerTier(p.id, { tierOverrideCode: code || null }); if (!r.ok) setErr(r.error ?? 'Lỗi'); });

  const existing = new Set(partners.map((p) => p.brandSlug));

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">Brand
              <select className="block border rounded px-2 py-1 mt-1" value={brandSlug} onChange={(e) => setBrandSlug(e.target.value)}>
                <option value="">— chọn —</option>
                {brands.filter((b) => !existing.has(b.slug)).map((b) => <option key={b.slug} value={b.slug}>{b.displayName ?? b.slug}</option>)}
              </select>
            </label>
            <label className="text-sm">Kỳ bill
              <select className="block border rounded px-2 py-1 mt-1" value={cycle} onChange={(e) => setCycle(e.target.value as 'weekly' | 'monthly')}>
                <option value="monthly">Tháng</option><option value="weekly">Tuần</option>
              </select>
            </label>
            <Button onClick={add} disabled={pending || !brandSlug}>Thêm</Button>
            <span className="text-xs text-muted-foreground">Giá theo tier chiết khấu tự động (bảng giá gốc markup 40%).</span>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground">
              <tr className="[&>th]:text-left [&>th]:p-3">
                <th>Brand</th><th>Tier hiệu lực</th><th>Đơn T-1</th><th>Strategic</th><th>Override</th><th>Kỳ</th><th>Trạng thái</th><th></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const tier = resolveTier({ strategic: p.strategic, overrideCode: p.tierOverrideCode, autoCode: p.tierCode });
                const eff = Math.round(effectiveMarkupPercent(tier.discountPct) * 10) / 10;
                const ck = Math.round(tier.discountPct * 100) / 100;
                return (
                  <tr key={p.id} className="border-b [&>td]:p-3">
                    <td>{p.displayName ?? p.brandSlug}</td>
                    <td>
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TIER_BADGE[tier.code] ?? TIER_BADGE.standard}`}>{tier.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">CK {ck}% · markup {eff}%</span>
                      {p.strategic && <span className="ml-1 text-xs" title="Strategic — luôn bậc cao nhất">⭐</span>}
                    </td>
                    <td className="tabular-nums">{p.lastMonthOrders} <span className="text-xs text-muted-foreground">→ {SHIP_HO_TIERS.find((t) => t.code === p.tierCode)?.name ?? p.tierCode}</span></td>
                    <td>
                      {canManage ? (
                        <input type="checkbox" checked={p.strategic} disabled={pending} onChange={(e) => setStrategic(p, e.target.checked)} />
                      ) : (p.strategic ? '⭐' : '—')}
                    </td>
                    <td>
                      {canManage ? (
                        <select className="border rounded px-1.5 py-0.5 text-xs" value={p.tierOverrideCode ?? ''} disabled={pending}
                          onChange={(e) => setOverride(p, e.target.value)}>
                          <option value="">— theo auto —</option>
                          {SHIP_HO_TIERS.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                        </select>
                      ) : (p.tierOverrideCode ?? '—')}
                    </td>
                    <td>{p.billingCycle === 'weekly' ? 'Tuần' : 'Tháng'}</td>
                    <td>{p.status === 'active' ? 'Bật' : 'Tắt'}</td>
                    <td className="text-right space-x-2 flex justify-end">
                      <Link href={`/f/ship-ho/partners/${p.brandSlug}/rate-card`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Rate card</Link>
                      {canManage && <Button variant="outline" size="sm" onClick={() => toggle(p)} disabled={pending}>{p.status === 'active' ? 'Tắt' : 'Bật'}</Button>}
                    </td>
                  </tr>
                );
              })}
              {partners.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chưa có đối tác ship hộ.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
