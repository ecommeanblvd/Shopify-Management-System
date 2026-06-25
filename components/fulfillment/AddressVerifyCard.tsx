import { Card, CardContent } from '@/components/ui/card';
import { AddressVerifyButton } from './AddressVerifyButton';

export interface FulfillmentAddress {
  country: string | null; city: string | null; line1: string | null; line2: string | null;
  province: string | null; name: string | null;
  addrClass: string | null; addrDeliverable: boolean | null; addrIssue: string | null;
  addrStandardized: string | null; addrVerifiedAt: Date | null;
  addrConfidence: string | null;
}

const CONFIDENCE_MAP: Record<string, { label: string; cls: string; border: boolean }> = {
  verified:        { label: '✓ Giao được', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', border: false },
  census_verified: { label: '✓ Xác nhận qua Census', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', border: false },
  zip_only:        { label: '⚠ Chưa xác minh số nhà (ZIP hợp lệ)', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', border: false },
  undeliverable:   { label: '⚠ Không giao được', cls: 'bg-red-500/15 text-red-700 dark:text-red-400', border: true },
};

const CLASS_MAP: Record<string, { label: string; cls: string }> = {
  RESIDENTIAL: { label: '🏠 Nhà dân', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  BUSINESS: { label: '🏢 Doanh nghiệp', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  MIXED: { label: 'Hỗn hợp', cls: 'bg-muted text-muted-foreground' },
  UNKNOWN: { label: 'Chưa rõ', cls: 'bg-muted text-muted-foreground' },
};

/** Địa chỉ giao + verify FedEx — hiển thị ở trang vận hành đơn để ops bắt địa
 *  chỉ sai/không giao được TRƯỚC khi ship. */
export function AddressVerifyCard({ address: a, orderId }: { address: FulfillmentAddress | null; orderId?: string }) {
  if (!a) return null;
  const hasStreet = !!a.line1;
  const full = [a.name, a.line1, a.line2, a.city, a.province, a.country].filter(Boolean).join(', ');
  const cls = a.addrClass ? CLASS_MAP[a.addrClass] ?? CLASS_MAP.UNKNOWN : null;

  return (
    <Card className={(a.addrConfidence ? a.addrConfidence === 'undeliverable' : a.addrDeliverable === false) ? 'border-red-500/40' : undefined}>
      <CardContent className="p-3 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Địa chỉ giao</div>
          {orderId && <AddressVerifyButton orderId={orderId} />}
        </div>
        {hasStreet
          ? <div className="text-foreground">{full || '—'}</div>
          : <div className="text-muted-foreground italic">Chưa có địa chỉ đầy đủ (đơn cũ — cần re-sync).</div>}
        {a.addrVerifiedAt ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {cls && <span className={`rounded px-2 py-0.5 font-medium ${cls.cls}`}>{cls.label}</span>}
            {(() => {
              const conf = a.addrConfidence ? CONFIDENCE_MAP[a.addrConfidence] : null;
              if (conf) return <span className={`rounded px-2 py-0.5 font-medium ${conf.cls}`}>{conf.label}</span>;
              return (
                <span className={`rounded px-2 py-0.5 font-medium ${a.addrDeliverable ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
                  {a.addrDeliverable ? '✓ Giao được' : '⚠ Không giao được — kiểm tra trước khi ship'}
                </span>
              );
            })()}
            {a.addrIssue && <span className="rounded px-2 py-0.5 font-medium bg-red-500/10 text-red-600 dark:text-red-400">{a.addrIssue}</span>}
          </div>
        ) : hasStreet ? (
          <div className="text-xs text-muted-foreground">Chưa verify địa chỉ.</div>
        ) : null}
        {a.addrStandardized && a.addrVerifiedAt && a.addrStandardized.toUpperCase() !== full.toUpperCase() && (
          <div className="text-[11px] text-muted-foreground">FedEx chuẩn hoá: <span className="font-mono">{a.addrStandardized}</span></div>
        )}
      </CardContent>
    </Card>
  );
}
