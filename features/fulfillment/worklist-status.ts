export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
export interface Badge { label: string; tone: BadgeTone }

/** 'YYYY-MM-DD' → 'dd/MM' (thuần, không Date/timezone). */
function ddmm(iso: string | null): string {
  if (!iso || iso.length < 10) return '?';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function summarizeAddr(o: { addrDeliverable: boolean | null; addrVerifiedAt: Date | string | null; addrConfidence?: string | null }): Badge {
  switch (o.addrConfidence) {
    case 'verified':
    case 'census_verified': return { label: '✓ Giao được', tone: 'ok' };
    case 'zip_only': return { label: '⚠ ZIP hợp lệ, chưa rõ số nhà', tone: 'warn' };
    case 'undeliverable': return { label: '⚠ Không giao được', tone: 'bad' };
  }
  // null / giá trị lạ → fallback boolean cũ
  if (!o.addrVerifiedAt) return { label: 'Chưa verify', tone: 'muted' };
  if (o.addrDeliverable === false) return { label: '⚠ Không giao được', tone: 'bad' };
  return { label: '✓ Giao được', tone: 'ok' };
}

export function summarizeBrand(o: { total: number; awaiting: number; confirmed: number; delivered: number; minExpected: string | null }): Badge {
  if (o.total === 0) return { label: 'Không cần', tone: 'muted' };
  if (o.delivered === o.total) return { label: '✓ Đã giao', tone: 'ok' };
  if (o.awaiting > 0) return { label: 'Chờ confirm', tone: 'warn' };
  if (o.confirmed > 0) return { label: `Confirm · ${ddmm(o.minExpected)}`, tone: 'info' };
  return { label: '—', tone: 'muted' };
}

export function summarizeKcs(o: { pending: number; pass: number; fail: number }): Badge {
  if (o.fail > 0) return { label: 'Lỗi', tone: 'bad' };
  if (o.pending > 0) return { label: 'Chờ', tone: 'warn' };
  if (o.pass > 0) return { label: 'Đạt', tone: 'ok' };
  return { label: '—', tone: 'muted' };
}

export function summarizeDelivery(o: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number }): Badge {
  if (o.packs === 0) return { label: 'Chưa', tone: 'muted' };
  if (o.exception > 0) return { label: 'Sự cố', tone: 'bad' };
  if (o.delivered === o.packs) return { label: 'Đã giao', tone: 'ok' };
  if (o.inTransit > 0) return { label: 'Đang chuyển', tone: 'info' };
  if (o.withTracking > 0) return { label: 'Có tracking', tone: 'info' };
  return { label: 'Chưa ship', tone: 'muted' };
}
