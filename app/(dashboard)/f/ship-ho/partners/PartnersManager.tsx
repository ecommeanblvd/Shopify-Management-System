'use client';

import { useState, useTransition } from 'react';
import { createShipHoPartner, updateShipHoPartner } from '@/features/ship-ho/partners-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Partner {
  id: string; brandSlug: string; displayName: string | null;
  markupPercent: string; billingCycle: string; billingCurrency: string; status: string; note: string | null;
}
interface Brand { slug: string; displayName: string | null }

export function PartnersManager({ partners, brands, canManage }: { partners: Partner[]; brands: Brand[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [brandSlug, setBrandSlug] = useState('');
  const [markup, setMarkup] = useState('20');
  const [cycle, setCycle] = useState<'weekly' | 'monthly'>('monthly');
  const [err, setErr] = useState<string | null>(null);

  const add = () =>
    start(async () => {
      setErr(null);
      const r = await createShipHoPartner({ brandSlug, markupPercent: markup, billingCycle: cycle, billingCurrency: 'VND' });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else { setBrandSlug(''); setMarkup('20'); }
    });

  const toggle = (p: Partner) =>
    start(async () => {
      await updateShipHoPartner(p.id, { status: p.status === 'active' ? 'inactive' : 'active' });
    });

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
            <label className="text-sm">Markup %
              <input className="block border rounded px-2 py-1 mt-1 w-24" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </label>
            <label className="text-sm">Kỳ bill
              <select className="block border rounded px-2 py-1 mt-1" value={cycle} onChange={(e) => setCycle(e.target.value as 'weekly' | 'monthly')}>
                <option value="monthly">Tháng</option><option value="weekly">Tuần</option>
              </select>
            </label>
            <Button onClick={add} disabled={pending || !brandSlug}>Thêm</Button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Brand</th><th>Markup</th><th>Kỳ</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-b [&>td]:p-3">
                  <td>{p.displayName ?? p.brandSlug}</td>
                  <td>{p.markupPercent}%</td>
                  <td>{p.billingCycle === 'weekly' ? 'Tuần' : 'Tháng'}</td>
                  <td>{p.status === 'active' ? 'Bật' : 'Tắt'}</td>
                  <td className="text-right">{canManage && <Button variant="outline" size="sm" onClick={() => toggle(p)} disabled={pending}>{p.status === 'active' ? 'Tắt' : 'Bật'}</Button>}</td>
                </tr>
              ))}
              {partners.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có đối tác ship hộ.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
