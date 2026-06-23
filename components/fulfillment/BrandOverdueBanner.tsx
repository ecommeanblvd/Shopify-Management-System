import Link from 'next/link';

export function BrandOverdueBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link
      href="/f/fulfillment/brand-requests?followup=1"
      className="block rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
    >
      ⚠ {count} đơn brand quá hạn giao — cần follow-up →
    </Link>
  );
}
