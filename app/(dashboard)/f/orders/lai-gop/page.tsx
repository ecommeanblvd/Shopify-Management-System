import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { thangKinhDoanh } from '@/lib/timezone';
import { layBrands } from '@/features/cogs/actions';
import { doanhThuTheoThang, cogsTheoThang, offlineTheoThang, tiGiaThang, chiTietThang } from '@/features/cogs/queries';
import { tinhBaoCao } from '@/features/cogs/bao-cao-logic';
import { doiTienTheoThang } from '@/features/cogs/tien';
import { thangHopLe, thangTruoc, danhSachThang } from '@/features/cogs/thang';
import { LaiGopTable, type LaiGopRow, type ChiTietDong } from '@/components/cogs/LaiGopTable';
import { TiGiaForm, type TiGiaHang } from '@/components/cogs/TiGiaForm';

export const dynamic = 'force-dynamic';

interface SearchParams {
  tu?: string;
  den?: string;
  store?: string;
  brand?: string;
  'chi-tiet'?: string;
}

export default async function LaiGopPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_cogs')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }
  const canManage = hasPermission(role, 'manage_cogs');

  const thangHienTai = thangKinhDoanh(new Date()) ?? '1970-01';
  const den = thangHopLe(sp.den) ? sp.den : thangHienTai;
  const tu = thangHopLe(sp.tu) ? sp.tu : thangTruoc(den, 5); // mặc định 6 tháng gần nhất
  const thang = danhSachThang(tu, den);

  const [storesAll, brands] = await Promise.all([
    db.select().from(schema.stores).where(eq(schema.stores.status, 'active')),
    layBrands(),
  ]);
  const storeChon = sp.store && storesAll.some((s) => s.id === sp.store) ? sp.store : '';
  const storeIds = storeChon ? [storeChon] : storesAll.map((s) => s.id);
  const brand = brands.some((b) => b.slug === sp.brand) ? sp.brand : undefined;

  const [doanhThu, cogs, offline, rates] = await Promise.all([
    doanhThuTheoThang(thang, storeIds, brand),
    cogsTheoThang(thang, storeIds, brand),
    offlineTheoThang(thang, brand),
    tiGiaThang(),
  ]);

  const baoCao = tinhBaoCao({ thang, doanhThu, cogs, offline, rates });
  const rows: LaiGopRow[] = baoCao.map((r) => ({
    ...r,
    tiGiaHieuLuc: doiTienTheoThang(1, 'USD', 'VND', r.period, rates)?.rate ?? null,
  }));

  // Tỉ giá đã nhập TRỰC TIẾP cho từng tháng trong khoảng (không phải tỉ giá tạm mượn từ tháng trước) — dữ liệu cho TiGiaForm.
  const fxRows = await db.select().from(schema.fxMonthRates).where(eq(schema.fxMonthRates.fromCurrency, 'USD'));
  const tiGiaTheoThang: TiGiaHang[] = thang.map((period) => {
    const hang = fxRows.find((r) => r.period === period && r.toCurrency === 'VND');
    return hang ? { period, rate: Number(hang.rate), source: hang.source } : { period, rate: null, source: null };
  });

  // Chi tiết theo brand → line cho tháng đang xem (nếu có).
  const chiTietPeriod = thangHopLe(sp['chi-tiet']) && thang.includes(sp['chi-tiet']) ? sp['chi-tiet'] : null;
  let chiTiet: ChiTietDong[] | null = null;
  if (chiTietPeriod) {
    const raw = await chiTietThang(chiTietPeriod, brand);
    const brandName = (slug: string | null) => brands.find((b) => b.slug === slug)?.displayName ?? slug ?? '(không rõ brand)';
    chiTiet = raw.map((r) => ({ ...r, brandName: brandName(r.brandSlug) }));
  }

  const querySuffix = `tu=${tu}&den=${den}${storeChon ? `&store=${storeChon}` : ''}${brand ? `&brand=${brand}` : ''}`;

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-2 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight">Lãi gộp theo tháng</h1>
        <p className="text-sm text-muted-foreground">
          Doanh thu thuần trừ phí ship và giá vốn theo line đơn, quy đổi VND theo tỉ giá tháng. Chi brand ngoài Shopify hiện cột riêng, không trừ vào lãi gộp.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <div className="space-y-1">
          <label htmlFor="tu" className="text-xs text-muted-foreground">Từ tháng</label>
          <input id="tu" name="tu" type="month" defaultValue={tu} className="h-9 border border-input bg-input/30 rounded-md px-3 text-sm" />
        </div>
        <div className="space-y-1">
          <label htmlFor="den" className="text-xs text-muted-foreground">Đến tháng</label>
          <input id="den" name="den" type="month" defaultValue={den} className="h-9 border border-input bg-input/30 rounded-md px-3 text-sm" />
        </div>
        <div className="space-y-1">
          <label htmlFor="store" className="text-xs text-muted-foreground">Cửa hàng</label>
          <select id="store" name="store" defaultValue={storeChon} className="h-9 border border-input bg-input/30 rounded-md px-3 text-sm min-w-40">
            <option value="">Tất cả cửa hàng</option>
            {storesAll.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="brand" className="text-xs text-muted-foreground">Brand</label>
          <select id="brand" name="brand" defaultValue={brand ?? ''} className="h-9 border border-input bg-input/30 rounded-md px-3 text-sm min-w-40">
            <option value="">Tất cả brand</option>
            {brands.map((b) => <option key={b.slug} value={b.slug}>{b.displayName}</option>)}
          </select>
        </div>
        <button type="submit" className="h-9 px-4 rounded-md border border-input bg-primary text-primary-foreground text-sm font-medium">
          Lọc
        </button>
      </form>

      <LaiGopTable rows={rows} querySuffix={querySuffix} chiTietPeriod={chiTietPeriod} chiTiet={chiTiet} />

      {canManage && <TiGiaForm hang={tiGiaTheoThang} thangHienTai={thangHienTai} />}
    </div>
  );
}
