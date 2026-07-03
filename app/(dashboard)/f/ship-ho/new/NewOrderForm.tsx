'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createShipHoOrder } from '@/features/ship-ho/orders-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SearchSelect } from '@/components/ui/search-select';
import { COUNTRIES, dialCodeFor } from '@/lib/geo/countries';
import { citiesFor } from '@/lib/geo/cities';

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.iso2, label: `${c.name} (${c.iso2})` }));

interface PartnerOpt { slug: string; name: string }
interface AccountOpt { id: string; name: string; carrierKey: string }

export function NewOrderForm({ partners, accounts, userEmail }: { partners: PartnerOpt[]; accounts: AccountOpt[]; userEmail: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    code: '', partnerBrandSlug: '', recipientName: '', country: '', city: '', postcode: '',
    address1: '', weightKg: '', dimLengthCm: '', dimWidthCm: '', dimHeightCm: '',
    packagingType: '' as '' | 'bag' | 'box', carrierAccountId: '', phone: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = () =>
    start(async () => {
      setErr(null);
      const acc = accounts.find((a) => a.id === f.carrierAccountId);
      const dial = f.country ? dialCodeFor(f.country) : null;
      const recipientPhone = f.phone.trim()
        ? (dial ? `+${dial} ${f.phone.trim()}` : f.phone.trim())
        : undefined;
      const r = await createShipHoOrder({
        code: f.code, partnerBrandSlug: f.partnerBrandSlug, recipientName: f.recipientName,
        recipientPhone,
        country: f.country, city: f.city, postcode: f.postcode, address1: f.address1,
        weightKg: f.weightKg, dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
        dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
        carrierKey: acc?.carrierKey, carrierAccountId: f.carrierAccountId || undefined, createdBy: userEmail,
      });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else router.push(`/f/ship-ho/${r.id}`);
    });

  const inputCls = 'block w-full border rounded px-2 py-1 mt-1';
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <label className="text-sm">Mã đơn *<input className={inputCls} value={f.code} onChange={set('code')} placeholder="DISCN001" /></label>
        <label className="text-sm">Đối tác *
          <select className={inputCls} value={f.partnerBrandSlug} onChange={set('partnerBrandSlug')}>
            <option value="">— chọn —</option>
            {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Người nhận<input className={inputCls} value={f.recipientName} onChange={set('recipientName')} /></label>
        <label className="text-sm">Số điện thoại
          <div className="flex gap-2 mt-1">
            <span className="inline-flex items-center px-2 border rounded bg-muted text-sm min-w-14 justify-center">
              {f.country && dialCodeFor(f.country) ? `+${dialCodeFor(f.country)}` : '—'}
            </span>
            <input
              className="block w-full border rounded px-2 py-1"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
              placeholder="Số điện thoại người nhận"
            />
          </div>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">Quốc gia (ISO2) *
            <SearchSelect
              value={f.country}
              onChange={(v) => setF({ ...f, country: v, city: '' })}
              options={COUNTRY_OPTIONS}
              placeholder="Tìm quốc gia…"
            />
          </label>
          <label className="text-sm">Thành phố
            <SearchSelect
              value={f.city}
              onChange={(v) => setF({ ...f, city: v })}
              options={citiesFor(f.country).map((c) => ({ value: c, label: c }))}
              placeholder={f.country ? 'Chọn/nhập thành phố…' : 'Chọn quốc gia trước'}
              allowFreeEntry
              disabled={!f.country}
            />
          </label>
          <label className="text-sm">Postcode<input className={inputCls} value={f.postcode} onChange={set('postcode')} /></label>
        </div>
        <label className="text-sm">Địa chỉ<input className={inputCls} value={f.address1} onChange={set('address1')} /></label>
        <div className="grid grid-cols-4 gap-2">
          <label className="text-sm">Cân (kg) *<input className={inputCls} value={f.weightKg} onChange={set('weightKg')} /></label>
          <label className="text-sm">D (cm)<input className={inputCls} value={f.dimLengthCm} onChange={set('dimLengthCm')} /></label>
          <label className="text-sm">R (cm)<input className={inputCls} value={f.dimWidthCm} onChange={set('dimWidthCm')} /></label>
          <label className="text-sm">C (cm)<input className={inputCls} value={f.dimHeightCm} onChange={set('dimHeightCm')} /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Kiểu đóng gói
            <select className={inputCls} value={f.packagingType} onChange={set('packagingType')}>
              <option value="">—</option><option value="bag">Bag (Pak)</option><option value="box">Box</option>
            </select>
          </label>
          <label className="text-sm">Carrier account
            <select className={inputCls} value={f.carrierAccountId} onChange={set('carrierAccountId')}>
              <option value="">— chọn để tính giá —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button onClick={submit} disabled={pending}>{pending ? 'Đang tạo…' : 'Tạo đơn & tính giá'}</Button>
      </CardContent>
    </Card>
  );
}
