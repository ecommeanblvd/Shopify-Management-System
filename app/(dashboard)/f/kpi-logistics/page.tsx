import { redirect } from 'next/navigation';

/**
 * Trang KPI Logistics đã dọn vào Báo cáo ship → tab "KPI Logistics" (CEO 10/09/2026) để mọi báo cáo vận chuyển nằm
 * một chỗ. Giữ route này chuyển hướng cho link cũ / bookmark không chết. Route xuất CSV vẫn ở nguyên chỗ cũ.
 */
export default async function KpiLogisticsRedirect({ searchParams }: { searchParams: Promise<{ ky?: string }> }) {
  const sp = await searchParams;
  redirect(`/f/ship-report?tab=kpi${sp.ky ? `&ky=${encodeURIComponent(sp.ky)}` : ''}`);
}
