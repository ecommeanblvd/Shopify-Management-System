'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ArrowDown, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { MODULE_KEYS, type ModuleKey, type CustomerAccountConfig } from '@/features/customer-account/config-schema';
import { saveCustomerAccountConfig, uploadCustomerAccountAsset } from '@/features/customer-account/admin-actions';

interface StoreRef { id: string; name: string; shopDomain: string }
interface AssetRef { id: string; kind: string; filename: string }
type ModuleRow = CustomerAccountConfig['modules'][number];

interface Props {
  stores: StoreRef[];
  enabled: boolean;
  config: CustomerAccountConfig;
  assets: AssetRef[];
  activeStoreId: string | null;
  canManage: boolean;
}

const MODULE_LABELS: Record<ModuleKey, string> = {
  tracking: 'Order Tracking (Journey)', wishlist: 'Wishlist',
};

const CHECKER = 'bg-muted [background-image:repeating-conic-gradient(theme(colors.border)_0_25%,transparent_0_50%)] [background-size:12px_12px]';

/** Merge saved modules with every MODULE_KEY so all 2 rows show, saved order first. */
function buildRows(config: CustomerAccountConfig): ModuleRow[] {
  const bySaved = new Map(config.modules.map((m) => [m.key, m]));
  const ordered: ModuleRow[] = config.modules.map((m) => ({ ...m }));
  for (const key of MODULE_KEYS) {
    if (!bySaved.has(key)) ordered.push({ key, enabled: false });
  }
  return ordered;
}

export function ConfigEditor({ stores, enabled, config, assets, activeStoreId, canManage }: Props) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const [isEnabled, setIsEnabled] = useState(enabled);
  const [supportEmail, setSupportEmail] = useState(config.branding.supportEmail ?? '');
  const [announcement, setAnnouncement] = useState(config.branding.announcement ?? '');
  const [logoAssetId, setLogoAssetId] = useState(config.branding.logoAssetId ?? '');
  const [heroAssetId, setHeroAssetId] = useState(config.branding.heroAssetId ?? '');
  const [modules, setModules] = useState<ModuleRow[]>(() => buildRows(config));

  const assetsByKind = (kind: string) => assets.filter((a) => a.kind === kind);
  const disabled = !canManage;

  function onStoreChange(id: string) {
    router.push(`/f/customer-account?store=${id}`);
  }

  function move(index: number, dir: -1 | 1) {
    setModules((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setModule(index: number, patch: Partial<ModuleRow>) {
    setModules((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function onSave() {
    if (!activeStoreId) return;
    setResult(null);
    startSave(async () => {
      const branding = {
        ...(supportEmail.trim() ? { supportEmail: supportEmail.trim() } : {}),
        ...(announcement.trim() ? { announcement: announcement.trim() } : {}),
        ...(logoAssetId ? { logoAssetId } : {}),
        ...(heroAssetId ? { heroAssetId } : {}),
      };
      const res = await saveCustomerAccountConfig(activeStoreId, isEnabled, { branding, modules });
      setResult(res.ok ? 'Đã lưu.' : `Lỗi: ${res.error ?? 'không rõ'}`);
      if (res.ok) router.refresh();
    });
  }

  if (!activeStoreId) {
    return <p className="text-sm text-muted-foreground">Chưa có store nào để cấu hình.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Store picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label htmlFor="ca-store" className="text-xs uppercase tracking-wider text-muted-foreground">Store</Label>
        <select
          id="ca-store"
          value={activeStoreId}
          onChange={(e) => onStoreChange(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {s.shopDomain}</option>
          ))}
        </select>
      </div>

      {!canManage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Bạn chỉ có quyền xem — cần <code>manage_functions</code> để chỉnh sửa.
        </p>
      )}

      {/* Enable toggle */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <div className="text-sm font-medium">Bật Customer Account cho store này</div>
            <div className="text-xs text-muted-foreground">Khi tắt, extension trả về config rỗng.</div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isEnabled}
              disabled={disabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="size-4"
            />
            {isEnabled ? 'Bật' : 'Tắt'}
          </label>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardContent className="space-y-5 p-5">
          <h2 className="text-sm font-semibold">Branding</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ca-email">Support email</Label>
              <Input
                id="ca-email"
                type="email"
                value={supportEmail}
                disabled={disabled}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="support@store.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-announce">Announcement</Label>
              <Textarea
                id="ca-announce"
                value={announcement}
                disabled={disabled}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="Banner text hiển thị đầu trang tài khoản"
                rows={2}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <AssetPicker
              label="Logo (PNG)"
              kind="logo"
              storeId={activeStoreId}
              value={logoAssetId}
              onChange={setLogoAssetId}
              assets={assetsByKind('logo')}
              disabled={disabled}
            />
            <AssetPicker
              label="Hero (PNG)"
              kind="hero"
              storeId={activeStoreId}
              value={heroAssetId}
              onChange={setHeroAssetId}
              assets={assetsByKind('hero')}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Modules */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Modules</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Bật</th>
                  <th className="py-2 pr-3 font-medium">Module</th>
                  <th className="py-2 pr-3 font-medium">Tiêu đề</th>
                  <th className="py-2 pr-3 font-medium">Icon</th>
                  <th className="py-2 font-medium">Thứ tự</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m, i) => (
                  <tr key={m.key} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={m.enabled}
                        disabled={disabled}
                        onChange={(e) => setModule(i, { enabled: e.target.checked })}
                        className="size-4"
                        aria-label={`Bật ${MODULE_LABELS[m.key]}`}
                      />
                    </td>
                    <td className="py-2 pr-3 font-medium">{MODULE_LABELS[m.key]}</td>
                    <td className="py-2 pr-3">
                      <Input
                        value={m.title ?? ''}
                        disabled={disabled}
                        onChange={(e) => setModule(i, { title: e.target.value })}
                        placeholder={MODULE_LABELS[m.key]}
                        className="h-8"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={m.iconAssetId ?? ''}
                          disabled={disabled}
                          onChange={(e) => setModule(i, { iconAssetId: e.target.value || undefined })}
                          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
                          aria-label={`Icon ${MODULE_LABELS[m.key]}`}
                        >
                          <option value="">— không —</option>
                          {assetsByKind('icon').map((a) => (
                            <option key={a.id} value={a.id}>{a.filename}</option>
                          ))}
                        </select>
                        {m.iconAssetId && (
                          <span className={`inline-flex size-8 items-center justify-center rounded ${CHECKER}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/customer-account/assets/${m.iconAssetId}`} alt="" className="h-6" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon-xs" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Lên">
                          <ArrowUp />
                        </Button>
                        <Button type="button" variant="outline" size="icon-xs" disabled={disabled || i === modules.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">
                          <ArrowDown />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Upload icon assets */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Upload icon (PNG)</h2>
          <AssetUploader kind="icon" storeId={activeStoreId} disabled={disabled} />
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={disabled || isSaving}>
          {isSaving && <Loader2 className="animate-spin" />}
          Lưu
        </Button>
        {result && <span className="text-sm text-muted-foreground">{result}</span>}
      </div>
    </div>
  );
}

function AssetPicker({
  label, kind, storeId, value, onChange, assets, disabled,
}: {
  label: string; kind: string; storeId: string; value: string;
  onChange: (id: string) => void; assets: AssetRef[]; disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
          aria-label={label}
        >
          <option value="">— không —</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.filename}</option>
          ))}
        </select>
        {value && (
          <span className={`inline-flex h-10 items-center justify-center rounded px-2 ${CHECKER}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/customer-account/assets/${value}`} alt="" className="h-8" />
          </span>
        )}
      </div>
      <AssetUploader kind={kind} storeId={storeId} disabled={disabled} onUploaded={onChange} />
    </div>
  );
}

function AssetUploader({
  kind, storeId, disabled, onUploaded,
}: {
  kind: string; storeId: string; disabled: boolean; onUploaded?: (id: string) => void;
}) {
  const router = useRouter();
  const [isUploading, startUpload] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    setErr(null);
    const formData = new FormData();
    formData.set('file', file);
    startUpload(async () => {
      const res = await uploadCustomerAccountAsset(storeId, kind, formData);
      if (res.ok && res.assetId) {
        onUploaded?.(res.assetId);
        router.refresh();
      } else {
        setErr(res.error ?? 'Upload lỗi');
      }
    });
  }

  return (
    <div className="space-y-1">
      <label className={`inline-flex items-center gap-1.5 text-xs ${disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'} text-muted-foreground hover:text-foreground`}>
        {isUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        Upload PNG
        <input
          type="file"
          accept="image/png"
          disabled={disabled || isUploading}
          onChange={(e) => onFile(e.target.files?.[0])}
          className="hidden"
        />
      </label>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
