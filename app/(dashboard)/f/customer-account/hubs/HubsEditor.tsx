'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { upsertHub, toggleHub } from '@/features/customer-account/hubs-actions';
import type { HubRow } from '@/features/customer-account/hubs-shared';

interface Props {
  rows: HubRow[];
  canManage: boolean;
}

interface HubFormValue {
  label: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

const EMPTY_FORM: HubFormValue = {
  label: '',
  recipientName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  phone: '',
};

export function HubsEditor({ rows, canManage }: Props) {
  const disabled = !canManage;

  return (
    <div className="space-y-6">
      {!canManage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Bạn chỉ có quyền xem — cần <code>manage_functions</code> để chỉnh sửa.
        </p>
      )}

      {/* Thêm mới */}
      <AddHubForm disabled={disabled} />

      {/* Bảng hub hiện có */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2.5 px-4 font-medium">Label</th>
                  <th className="py-2.5 px-4 font-medium">Người nhận</th>
                  <th className="py-2.5 px-4 font-medium">Địa chỉ</th>
                  <th className="py-2.5 px-4 font-medium">Quốc gia</th>
                  <th className="py-2.5 px-4 font-medium">Phone</th>
                  <th className="py-2.5 px-4 font-medium">Active</th>
                  <th className="py-2.5 px-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 px-4 text-center text-muted-foreground">
                      Chưa có return hub nào.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <HubRowItem key={r.id} row={r} disabled={disabled} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddHubForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [form, setForm] = useState<HubFormValue>(EMPTY_FORM);
  const [result, setResult] = useState<string | null>(null);

  function set<K extends keyof HubFormValue>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSave() {
    setResult(null);
    startSave(async () => {
      const res = await upsertHub({
        label: form.label,
        recipientName: form.recipientName,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || null,
        city: form.city,
        state: form.state || null,
        postalCode: form.postalCode || null,
        country: form.country,
        phone: form.phone || null,
      });
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) {
        setForm(EMPTY_FORM);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="text-sm font-medium">Thêm return hub</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-label" className="text-xs uppercase tracking-wider text-muted-foreground">Label</Label>
            <Input
              id="hub-add-label"
              value={form.label}
              disabled={disabled}
              onChange={(e) => set('label', e.target.value)}
              placeholder="US Hub"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-recipient" className="text-xs uppercase tracking-wider text-muted-foreground">Recipient name</Label>
            <Input
              id="hub-add-recipient"
              value={form.recipientName}
              disabled={disabled}
              onChange={(e) => set('recipientName', e.target.value)}
              placeholder="Nguyễn Văn A"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-address1" className="text-xs uppercase tracking-wider text-muted-foreground">Address line 1</Label>
            <Input
              id="hub-add-address1"
              value={form.addressLine1}
              disabled={disabled}
              onChange={(e) => set('addressLine1', e.target.value)}
              placeholder="123 Main St"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-address2" className="text-xs uppercase tracking-wider text-muted-foreground">Address line 2</Label>
            <Input
              id="hub-add-address2"
              value={form.addressLine2}
              disabled={disabled}
              onChange={(e) => set('addressLine2', e.target.value)}
              placeholder="Tuỳ chọn"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-city" className="text-xs uppercase tracking-wider text-muted-foreground">City</Label>
            <Input
              id="hub-add-city"
              value={form.city}
              disabled={disabled}
              onChange={(e) => set('city', e.target.value)}
              placeholder="Los Angeles"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-state" className="text-xs uppercase tracking-wider text-muted-foreground">State</Label>
            <Input
              id="hub-add-state"
              value={form.state}
              disabled={disabled}
              onChange={(e) => set('state', e.target.value)}
              placeholder="CA"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-postal" className="text-xs uppercase tracking-wider text-muted-foreground">Postal code</Label>
            <Input
              id="hub-add-postal"
              value={form.postalCode}
              disabled={disabled}
              onChange={(e) => set('postalCode', e.target.value)}
              placeholder="90001"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-country" className="text-xs uppercase tracking-wider text-muted-foreground">Country (ISO-2)</Label>
            <Input
              id="hub-add-country"
              value={form.country}
              disabled={disabled}
              onChange={(e) => set('country', e.target.value.toUpperCase())}
              placeholder="US"
              maxLength={2}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-add-phone" className="text-xs uppercase tracking-wider text-muted-foreground">Phone</Label>
            <Input
              id="hub-add-phone"
              value={form.phone}
              disabled={disabled}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="Tuỳ chọn"
              className="h-9"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={onSave} disabled={disabled || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Lưu
          </Button>
          {result && <span className="text-xs text-muted-foreground">{result}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function HubRowItem({ row, disabled }: { row: HubRow; disabled: boolean }) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [isToggling, startToggle] = useTransition();
  const [form, setForm] = useState<HubFormValue>({
    label: row.label,
    recipientName: row.recipientName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2 ?? '',
    city: row.city,
    state: row.state ?? '',
    postalCode: row.postalCode ?? '',
    country: row.country,
    phone: row.phone ?? '',
  });
  const [result, setResult] = useState<string | null>(null);

  function set<K extends keyof HubFormValue>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSave() {
    setResult(null);
    startSave(async () => {
      const res = await upsertHub({
        id: row.id,
        label: form.label,
        recipientName: form.recipientName,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || null,
        city: form.city,
        state: form.state || null,
        postalCode: form.postalCode || null,
        country: form.country,
        phone: form.phone || null,
      });
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) router.refresh();
    });
  }

  function onToggle() {
    setResult(null);
    startToggle(async () => {
      const res = await toggleHub(row.id, !row.active);
      if (res.ok) router.refresh();
      else setResult(`Lỗi: ${res.error ?? 'không rõ'}`);
    });
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="py-3 px-4">
        <Input
          value={form.label}
          disabled={disabled}
          onChange={(e) => set('label', e.target.value)}
          className="h-8 min-w-[8rem]"
          aria-label={`Label hub ${row.label}`}
        />
      </td>
      <td className="py-3 px-4">
        <Input
          value={form.recipientName}
          disabled={disabled}
          onChange={(e) => set('recipientName', e.target.value)}
          className="h-8 min-w-[8rem]"
          aria-label={`Recipient name hub ${row.label}`}
        />
      </td>
      <td className="py-3 px-4">
        <div className="grid gap-1.5 min-w-[16rem]">
          <Input
            value={form.addressLine1}
            disabled={disabled}
            onChange={(e) => set('addressLine1', e.target.value)}
            placeholder="Address line 1"
            className="h-8"
            aria-label={`Address line 1 hub ${row.label}`}
          />
          <Input
            value={form.addressLine2}
            disabled={disabled}
            onChange={(e) => set('addressLine2', e.target.value)}
            placeholder="Address line 2"
            className="h-8"
            aria-label={`Address line 2 hub ${row.label}`}
          />
          <div className="flex gap-1.5">
            <Input
              value={form.city}
              disabled={disabled}
              onChange={(e) => set('city', e.target.value)}
              placeholder="City"
              className="h-8"
              aria-label={`City hub ${row.label}`}
            />
            <Input
              value={form.state}
              disabled={disabled}
              onChange={(e) => set('state', e.target.value)}
              placeholder="State"
              className="h-8"
              aria-label={`State hub ${row.label}`}
            />
            <Input
              value={form.postalCode}
              disabled={disabled}
              onChange={(e) => set('postalCode', e.target.value)}
              placeholder="Postal"
              className="h-8"
              aria-label={`Postal code hub ${row.label}`}
            />
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <Input
          value={form.country}
          disabled={disabled}
          onChange={(e) => set('country', e.target.value.toUpperCase())}
          maxLength={2}
          className="h-8 w-16"
          aria-label={`Country hub ${row.label}`}
        />
      </td>
      <td className="py-3 px-4">
        <Input
          value={form.phone}
          disabled={disabled}
          onChange={(e) => set('phone', e.target.value)}
          className="h-8 min-w-[8rem]"
          aria-label={`Phone hub ${row.label}`}
        />
      </td>
      <td className="py-3 px-4 whitespace-nowrap">
        <Button
          type="button"
          size="sm"
          variant={row.active ? 'outline' : 'default'}
          onClick={onToggle}
          disabled={disabled || isToggling}
        >
          {isToggling && <Loader2 className="animate-spin" />}
          {row.active ? 'Active' : 'Inactive'}
        </Button>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={onSave} disabled={disabled || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Lưu
          </Button>
          {result && <span className="text-xs text-muted-foreground whitespace-nowrap">{result}</span>}
        </div>
      </td>
    </tr>
  );
}
