'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createShipHoOrder } from '@/features/ship-ho/orders-actions';
import { quoteShipHoLines, type LineQuote } from '@/features/ship-ho/quote-lines-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SearchSelect } from '@/components/ui/search-select';
import { COUNTRIES, dialCodeFor } from '@/lib/geo/countries';
import { citiesFor } from '@/lib/geo/cities';
import { requirementFor, validateAddressExtra } from '@/lib/geo/address-requirements';
import { lookupPostcodeAction } from '@/features/geo/geo-actions';

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.iso2, label: `${c.name} (${c.iso2})` }));

interface PartnerOpt { slug: string; name: string }

export function NewOrderForm({ partners, userEmail }: { partners: PartnerOpt[]; userEmail: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    code: '', partnerBrandSlug: '', recipientName: '', country: '', city: '', postcode: '',
    address1: '', weightKg: '', dimLengthCm: '', dimWidthCm: '', dimHeightCm: '',
    packagingType: '' as '' | 'bag' | 'box', phone: '',
    houseNumber: '', shortAddress: '', mapsUrl: '',
  });

  const [lines, setLines] = useState<LineQuote[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareErr, setCompareErr] = useState<string | null>(null);

  // cập nhật field + huỷ bảng so sánh cũ (giá phụ thuộc input)
  const patch = (partial: Partial<typeof f>) => {
    setF((prev) => ({ ...prev, ...partial }));
    setLines([]); setSelectedAccountId(''); setCompareErr(null);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => patch({ [k]: e.target.value } as Partial<typeof f>);

  const [geoHint, setGeoHint] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onPostcode(v: string) {
    patch({ postcode: v });
    if (geoTimer.current) clearTimeout(geoTimer.current);
    if (!f.country || !v.trim()) { setGeoHint(null); return; }
    geoTimer.current = setTimeout(async () => {
      const r = await lookupPostcodeAction(f.country, v);
      if (r.valid === true) {
        setGeoHint({ tone: 'ok', text: `✓ ${r.city}${r.stateCode ? ' · ' + r.stateCode : ''}` });
        if (r.city) patch({ city: r.city });
      } else if (r.valid === false) {
        setGeoHint({ tone: 'warn', text: '⚠ Không tìm thấy postcode' });
      } else setGeoHint(null);
    }, 500);
  }

  const submit = () =>
    start(async () => {
      setErr(null);
      const extra = validateAddressExtra(f.country, {
        houseNumber: f.houseNumber, shortAddress: f.shortAddress, mapsUrl: f.mapsUrl,
      });
      if (!extra.ok) { setErr(extra.error ?? 'Thiếu thông tin địa chỉ'); return; }
      const line = lines.find((l) => l.accountId === selectedAccountId);
      if (!line) { setErr('Chọn 1 line ship trước'); return; }
      const dial = f.country ? dialCodeFor(f.country) : null;
      const recipientPhone = f.phone.trim()
        ? (dial ? `+${dial} ${f.phone.trim()}` : f.phone.trim())
        : undefined;
      const r = await createShipHoOrder({
        code: f.code, partnerBrandSlug: f.partnerBrandSlug, recipientName: f.recipientName,
        recipientPhone,
        country: f.country, city: f.city, postcode: f.postcode, address1: f.address1,
        houseNumber: extra.normalized.houseNumber, shortAddress: extra.normalized.shortAddress, mapsUrl: extra.normalized.mapsUrl,
        weightKg: f.weightKg, dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
        dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
        carrierKey: line.carrierKey ?? undefined, carrierAccountId: line.accountId, createdBy: userEmail,
      });
      if (!r.ok) setErr(r.error ?? 'Lỗi');
      else router.push(`/f/ship-ho/${r.id}`);
    });

  const inputCls = 'block w-full border rounded px-2 py-1 mt-1';
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">Mã đơn *<input className={inputCls} value={f.code} onChange={set('code')} placeholder="DISCN001" /></label>
          <label className="text-sm">Đối tác *
            <select className={inputCls} value={f.partnerBrandSlug} onChange={set('partnerBrandSlug')}>
              <option value="">— chọn —</option>
              {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className="text-sm">Quốc gia (ISO2) *
            <SearchSelect
              value={f.country}
              onChange={(v) => patch({ country: v, city: '', houseNumber: '', shortAddress: '', mapsUrl: '' })}
              options={COUNTRY_OPTIONS}
              placeholder="Tìm quốc gia…"
            />
          </label>
          <label className="text-sm">Thành phố
            <SearchSelect
              value={f.city}
              onChange={(v) => patch({ city: v })}
              options={citiesFor(f.country).map((c) => ({ value: c, label: c }))}
              placeholder={f.country ? 'Chọn/nhập thành phố…' : 'Chọn quốc gia trước'}
              allowFreeEntry
              disabled={!f.country}
            />
          </label>
          <label className="text-sm">Postcode<input className={inputCls} value={f.postcode} onChange={(e) => onPostcode(e.target.value)} />
            {geoHint && <span className={`block text-xs mt-0.5 ${geoHint.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>{geoHint.text}</span>}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">Người nhận<input className={inputCls} value={f.recipientName} onChange={set('recipientName')} /></label>
          <label className="text-sm">Số điện thoại
            <div className="flex gap-2 mt-1">
              <span className="inline-flex items-center px-2 border rounded bg-muted text-sm min-w-14 justify-center">
                {f.country && dialCodeFor(f.country) ? `+${dialCodeFor(f.country)}` : '—'}
              </span>
              <input
                className="block w-full border rounded px-2 py-1"
                value={f.phone}
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder="Số điện thoại người nhận"
              />
            </div>
          </label>
        </div>
        <label className="text-sm block">Địa chỉ<input className={inputCls} value={f.address1} onChange={set('address1')} /></label>
        {requirementFor(f.country)?.houseNumber && (
          <label className="text-sm block">House Number *
            <input className={inputCls} value={f.houseNumber} onChange={set('houseNumber')} placeholder="Số nhà / building" />
          </label>
        )}
        {requirementFor(f.country)?.shortAddressOrMaps && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Saudi Arabia: nhập ít nhất 1 trong 2 — Short Address hoặc Google Maps link.</p>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm">Short Address
                <input className={inputCls} value={f.shortAddress} onChange={set('shortAddress')} placeholder="VD RBMA4176" />
              </label>
              <label className="text-sm">Google Maps link
                <input className={inputCls} value={f.mapsUrl} onChange={set('mapsUrl')} placeholder="https://maps.app.goo.gl/…" />
              </label>
            </div>
          </div>
        )}
        <div className="grid grid-cols-4 gap-4">
          <label className="text-sm">Cân (kg) *<input className={inputCls} value={f.weightKg} onChange={set('weightKg')} /></label>
          <label className="text-sm">D (cm)<input className={inputCls} value={f.dimLengthCm} onChange={set('dimLengthCm')} /></label>
          <label className="text-sm">R (cm)<input className={inputCls} value={f.dimWidthCm} onChange={set('dimWidthCm')} /></label>
          <label className="text-sm">C (cm)<input className={inputCls} value={f.dimHeightCm} onChange={set('dimHeightCm')} /></label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">Kiểu đóng gói
            <select className={inputCls} value={f.packagingType} onChange={set('packagingType')}>
              <option value="">—</option><option value="bag">Bag (Pak)</option><option value="box">Box</option>
            </select>
          </label>
        </div>
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            disabled={comparing || !f.partnerBrandSlug || !f.country || !f.weightKg}
            onClick={() =>
              start(async () => {
                setComparing(true); setCompareErr(null); setLines([]); setSelectedAccountId('');
                const r = await quoteShipHoLines({
                  partnerBrandSlug: f.partnerBrandSlug, weightKg: f.weightKg, country: f.country,
                  city: f.city || undefined, postcode: f.postcode || undefined,
                  dimLengthCm: f.dimLengthCm || undefined, dimWidthCm: f.dimWidthCm || undefined,
                  dimHeightCm: f.dimHeightCm || undefined, packagingType: f.packagingType || null,
                });
                setComparing(false);
                if (r.error) { setCompareErr(r.error); return; }
                setLines(r.lines);
              })
            }
          >
            {comparing ? 'Đang tính…' : 'So sánh giá line'}
          </Button>
          {compareErr && <p className="text-sm text-red-600 mt-1">{compareErr}</p>}
        </div>
        {lines.length > 0 && (
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b text-muted-foreground">
                <tr className="[&>th]:text-left [&>th]:p-2">
                  <th></th><th>Line</th><th>Cước carrier</th><th>Giá thu</th><th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.accountId}
                      className={`border-b cursor-pointer [&>td]:p-2 ${selectedAccountId === l.accountId ? 'bg-muted/60' : 'hover:bg-muted/30'}`}
                      onClick={() => setSelectedAccountId(l.accountId)}>
                    <td><input type="radio" name="ship-line" checked={selectedAccountId === l.accountId} onChange={() => setSelectedAccountId(l.accountId)} /></td>
                    <td>{l.name}{l.carrierKey ? ` · ${l.carrierKey}` : ''}</td>
                    <td>{l.carrierCostVnd.toLocaleString('vi-VN')} ₫</td>
                    <td className="font-medium">{l.chargedVnd.toLocaleString('vi-VN')} ₫</td>
                    <td>{l.marginVnd.toLocaleString('vi-VN')} ₫</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!comparing && lines.length === 0 && f.partnerBrandSlug && f.country && f.weightKg && !compareErr && (
          <p className="text-sm text-muted-foreground">Bấm &quot;So sánh giá line&quot;. Nếu không có line nào áp dụng cho tuyến này, kiểm tra cân/địa chỉ.</p>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button
          onClick={submit}
          disabled={pending || !selectedAccountId}
        >
          {pending ? 'Đang tạo…' : 'Confirm & tạo đơn'}
        </Button>
      </CardContent>
    </Card>
  );
}
