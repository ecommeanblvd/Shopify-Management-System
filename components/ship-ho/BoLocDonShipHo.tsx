'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CAC_MUC_DOI_SOAT, NHAN_DOI_SOAT } from '@/features/ship-ho/filter-orders';

/** Bộ lọc brand + trạng thái đối soát cho trang ship hộ — ghi lên URL (?brand=&doi_soat=)
 *  để Đức chia sẻ link / F5 không mất lọc; giữ nguyên các tham số khác (q, source). */
export function BoLocDonShipHo({ brands, brand, doiSoat, soDong }: {
  brands: Array<{ slug: string; name: string }>;
  brand?: string;
  doiSoat?: string;
  soDong?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const dat = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const dangLoc = Boolean(brand || doiSoat);
  const sel = 'h-9 rounded-md border border-border bg-background px-2 text-sm';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Brand</span>
        <select className={sel} value={brand ?? ''} onChange={(e) => dat('brand', e.target.value)} aria-label="Lọc theo brand">
          <option value="">Tất cả</option>
          {brands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Đối soát</span>
        <select className={sel} value={doiSoat ?? ''} onChange={(e) => dat('doi_soat', e.target.value)} aria-label="Lọc theo trạng thái đối soát">
          <option value="">Tất cả</option>
          {CAC_MUC_DOI_SOAT.map((k) => <option key={k} value={k}>{NHAN_DOI_SOAT[k]}</option>)}
        </select>
      </label>
      {soDong != null && <span className="text-muted-foreground tabular-nums">{soDong} đơn</span>}
      {dangLoc && (
        <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => { const next = new URLSearchParams(sp.toString()); next.delete('brand'); next.delete('doi_soat'); const qs = next.toString(); router.replace(qs ? `${pathname}?${qs}` : pathname); }}>
          Xoá lọc
        </button>
      )}
    </div>
  );
}
