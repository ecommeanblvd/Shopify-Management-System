import type { LineSource } from '@/features/warehouse/staging-logic';

/** Chip "Nguồn" của một dòng đơn — dùng chung StagingBoard + OrderDetailPanel (spec §5.3). */
export function SourceChip({ source }: { source: LineSource }) {
  const base = 'inline-block rounded px-2 py-0.5 text-xs font-medium';
  switch (source.kind) {
    case 'warehouse':
      return (
        <span className={`${base} bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400`}>
          Kho {source.code}
        </span>
      );
    case 'staging':
      return (
        <span className={`${base} bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400`}>
          Khu chờ
        </span>
      );
    case 'brand':
      return (
        <span className={`${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>
          Chờ brand
        </span>
      );
    case 'pending':
      return <span className={`${base} bg-muted text-muted-foreground`}>Chờ kiểm</span>;
    case 'progress':
      return (
        <span className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>
          Đã pick/đóng
        </span>
      );
    case 'shipped':
      return (
        <span className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>
          Đã đi
        </span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}
