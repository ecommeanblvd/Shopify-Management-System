import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ChevronLeft, Scale } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getRateComparison } from '@/features/carrier-rates/compare/actions';
import { RateComparison } from '@/components/carrier-rates/RateComparison';

export const dynamic = 'force-dynamic';

export default async function CompareRatesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }

  const data = await getRateComparison();
  const carrierCount = new Set(
    Object.values(data.cube.cells).flatMap((byW) =>
      Object.values(byW).flatMap((cell) => cell.rates.map((r) => r.accountId)),
    ),
  ).size;

  return (
    <div className="px-6 md:px-10 py-10 space-y-6">
      <div className="space-y-3">
        <Link href="/f/carrier-rates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Carrier rates
        </Link>
        <div className="flex items-center gap-2">
          <Scale className="size-6" />
          <h1 className="text-3xl font-semibold tracking-tight">So sánh cước carrier</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Cước all-in (đã gồm phụ phí xăng dầu tuần hiện tại + VAT), quy về VND, theo top nước có
          nhiều đơn Shopify × mốc cân 0.5→20kg. Mỗi ô liệt kê mọi carrier phủ nước đó — carrier rẻ
          nhất được tô đậm kèm % chênh so với rẻ nhất. Tính tại thời điểm{' '}
          <span className="font-medium text-foreground">{data.asOf}</span>.
        </p>
      </div>

      {data.countryMeta.length === 0 || carrierCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {carrierCount === 0
            ? 'Chưa có carrier nào có bảng giá hiệu lực hôm nay để so sánh.'
            : 'Chưa có đơn Shopify nào trong 6 tháng gần đây để lấy top nước.'}
        </div>
      ) : (
        <RateComparison cube={data.cube} countryMeta={data.countryMeta} />
      )}
    </div>
  );
}
