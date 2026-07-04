import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { TriangleAlert } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getOrderDossier } from '@/features/orders/dossier';
import { listSla } from '@/features/lifecycle/queries';
import {
  buildTimeline, fmtDuration, STAGE_LABELS, MAIN_CHAIN, nextStage, stageProgress, statusLabel,
} from '@/features/lifecycle/display';
import type { StageKey } from '@/features/lifecycle/derive';
import { SLA_SEGMENTS, type SlaKey } from '@/features/lifecycle/stats-logic';
import { stagePlaybook, type InfoKey } from '@/features/lifecycle/playbook';
import { segmentTimings, stageEstimateHrs } from '@/features/lifecycle/stage-timing';
import { AddressVerifyCard } from '@/components/fulfillment/AddressVerifyCard';
import { LarkDetailCard } from '@/components/fulfillment/LarkDetailCard';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | string | null) => d ? new Date(d).toLocaleString('vi-VN') : '—';
const fmtDay = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const APPROX_NOTE: Record<'first_seen' | 'out_of_order', string> = {
  first_seen: 'mới ghi nhận',
  out_of_order: 'lệch thứ tự — dữ liệu nguồn không nhất quán',
};

const TONE_CLS: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  bad: 'bg-red-500/15 text-red-700 dark:text-red-400',
  stale: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  muted: 'bg-muted text-muted-foreground',
};

export default async function LifecycleDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Forbidden</h1>
      </div>
    );
  }

  const [dossier, slaRows] = await Promise.all([
    getOrderDossier(orderId),
    listSla(),
  ]);
  if (!dossier) notFound();

  const { lifecycle, address, lines, brandRequests, packs, larkRecords, currentAction } = dossier;
  const stage = lifecycle.currentStage as StageKey;
  const nx = nextStage(stage);
  const st = statusLabel(lifecycle.delayStatus, lifecycle.delayHours);
  const { index } = stageProgress(stage);
  const timelineSteps = buildTimeline(lifecycle, lifecycle.syncedAt);

  // Build sla Record
  const sla = {} as Record<SlaKey, number>;
  for (const s of SLA_SEGMENTS) sla[s] = 0;
  for (const r of slaRows) {
    if ((SLA_SEGMENTS as string[]).includes(r.key)) sla[r.key as SlaKey] = r.targetHours;
  }

  const timings = segmentTimings(lifecycle, sla);
  const playbook = stagePlaybook(stage);

  // Map segmentTimings keyed by last milestone of each segment, for badge lookup
  // segment verdict is attached to the timeline point that closes the segment
  const SEGMENT_CLOSE_KEY: Record<SlaKey, string> = {
    placed_to_production: 'productionStartAt',
    production: 'goodsReceivedAt',
    qc: 'qcPassAt',
    pack: 'packedAt',
    ship: 'shippedAt',
    deliver: 'deliveredAt',
  };
  const verdictByKey = new Map<string, { verdict: 'đúng' | 'trễ' | null; actualHrs: number | null }>();
  for (const t of timings) {
    const closeKey = SEGMENT_CLOSE_KEY[t.segment];
    if (closeKey && t.verdict != null) {
      verdictByKey.set(closeKey, { verdict: t.verdict, actualHrs: t.actualHrs });
    }
  }

  // Render info grid for current stage
  const renderInfoValue = (key: InfoKey): string => {
    switch (key) {
      case 'address': {
        if (!address) return 'Chưa có';
        const parts = [address.city, address.province, address.country].filter(Boolean);
        return parts.join(', ') || address.line1 || 'Chưa có';
      }
      case 'items':
        return lines.length > 0
          ? `${lines.length} dòng · ${lines.map((l) => l.sku).filter(Boolean).join(', ')}`
          : 'Chưa có';
      case 'brand': {
        const vendors = [...new Set(brandRequests.map((b) => b.brandSlug).filter(Boolean))];
        return vendors.length > 0 ? vendors.join(', ') : '—';
      }
      case 'brandEta': {
        const etas = brandRequests
          .map((b) => (b as { expectedDeliveryDate?: string | null }).expectedDeliveryDate)
          .filter(Boolean);
        return etas.length > 0 ? etas[etas.length - 1]! : '—';
      }
      case 'brandRequests': {
        const total = brandRequests.length;
        const confirmed = brandRequests.filter(
          (b) => (b as { confirmStatus?: string }).confirmStatus === 'confirmed',
        ).length;
        const delivered = brandRequests.filter((b) => b.deliveredAt != null).length;
        return `${total} yêu cầu · ${confirmed} xác nhận · ${delivered} đã giao`;
      }
      case 'kcs':
        return lifecycle.qcPassAt ? `Pass · ${fmtDay(lifecycle.qcPassAt)}` : 'Chưa có';
      case 'packs':
        return packs.length > 0 ? `${packs.length} kiện` : 'Chưa đóng gói';
      case 'carrier': {
        const carriers = [...new Set(packs.map((p) => p.carrierKey).filter(Boolean))];
        return carriers.length > 0 ? carriers.join(', ') : '—';
      }
      case 'tracking': {
        const nums = packs.map((p) => p.trackingNumber).filter(Boolean);
        return nums.length > 0 ? nums.join(', ') : '—';
      }
      case 'deliveryStatus': {
        const statuses = [...new Set(packs.map((p) => p.deliveryStatus).filter(Boolean))];
        return statuses.length > 0 ? statuses.join(', ') : '—';
      }
      case 'refund':
        return lifecycle.refundedAt
          ? `Hoàn tiền · ${fmtDay(lifecycle.refundedAt)}`
          : (lifecycle.returnProcessingAt
              ? `Return processing · ${fmtDay(lifecycle.returnProcessingAt)}`
              : 'Chưa có');
    }
  };

  const INFO_LABELS: Record<InfoKey, string> = {
    address: 'Địa chỉ', items: 'Mặt hàng', brand: 'Brand', brandEta: 'ETA brand',
    brandRequests: 'Đơn brand', kcs: 'KCS', packs: 'Kiện', carrier: 'Carrier',
    tracking: 'Tracking', deliveryStatus: 'Tình trạng giao', refund: 'Hoàn tiền',
  };

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 space-y-6">
      {/* === 1. HEADER === */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {lifecycle.orderNumber ?? orderId.slice(0, 8)}
            </h1>
            {lifecycle.exception && (
              <TriangleAlert className="h-5 w-5 text-amber-500 shrink-0" aria-label="Có sự cố" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {lifecycle.storeName ?? '—'}
            {' · hiện tại '}
            <span className="text-foreground font-medium">{STAGE_LABELS[stage]}</span>
            {nx && (
              <>
                {' → chờ '}
                <span className="text-foreground font-medium">{STAGE_LABELS[nx]}</span>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLS[st.tone] ?? TONE_CLS.muted}`}>
              {st.text}
            </span>
            <span className="inline-flex items-center rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
              {currentAction.label}
            </span>
          </div>
        </div>
        <Link href="/f/lifecycle" className={buttonVariants({ variant: 'outline' })}>← Danh sách</Link>
      </div>

      {/* === 2. STEPPER === */}
      {MAIN_CHAIN.includes(stage) && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start">
              {MAIN_CHAIN.map((s, i) => (
                <div key={s} className="flex-1 flex flex-col items-center text-center">
                  <div className="flex items-center w-full">
                    <span className={`h-[2px] flex-1 ${i === 0 ? 'opacity-0' : i <= index ? 'bg-foreground' : 'bg-border'}`} />
                    <span className={`mx-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${i < index ? 'bg-foreground border-foreground' : i === index ? 'border-foreground' : 'border-border bg-transparent'}`} />
                    <span className={`h-[2px] flex-1 ${i === MAIN_CHAIN.length - 1 ? 'opacity-0' : i < index ? 'bg-foreground' : 'bg-border'}`} />
                  </div>
                  <span className={`mt-1.5 text-[11px] ${i === index ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                    {STAGE_LABELS[s]}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* === 3. HÀNH TRÌNH (timeline) === */}
      <Card>
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
            Hành trình · theo thời gian thật
          </div>
          <ol className="relative border-l ml-2 space-y-6">
            {timelineSteps.map((s) => {
              const verd = verdictByKey.get(s.key);
              return (
                <li key={s.key} className="ml-4">
                  <span className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full ${s.approx ? 'bg-background border-2 border-border' : 'bg-foreground'}`} />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={s.approx ? 'text-muted-foreground' : 'font-medium'}>
                      {s.label}
                      {s.approxReason && (
                        <span className="ml-2 text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          ≈ {APPROX_NOTE[s.approxReason]}
                        </span>
                      )}
                      {verd && (
                        <span className={`ml-2 text-[11px] rounded px-1.5 py-0.5 font-medium ${verd.verdict === 'đúng' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}>
                          {verd.verdict}{verd.actualHrs != null ? ` · ${fmtDuration(verd.actualHrs)}` : ''}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {s.approx ? `≈ ${fmtDay(s.at)}` : fmt(s.at)}
                    </span>
                  </div>
                  {s.durationHrs != null && (
                    <div className="text-xs text-muted-foreground">+{fmtDuration(s.durationHrs)} từ mốc trước</div>
                  )}
                </li>
              );
            })}

            {/* Point HIỆN TẠI — card mở rộng */}
            <li className="ml-4">
              <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-foreground ring-2 ring-background" />
              <div className="rounded-lg border border-border bg-card p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{STAGE_LABELS[stage]} (hiện tại)</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLS[currentAction.tone] ?? TONE_CLS.muted}`}>
                    {currentAction.label}
                  </span>
                </div>

                <div className="text-sm">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Cần làm</div>
                  <p className="text-foreground">{playbook.whatToDo}</p>
                </div>

                {playbook.infoKeys.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Thông tin</div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {playbook.infoKeys.map((k) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{INFO_LABELS[k]}</dt>
                          <dd className="text-foreground break-words">{renderInfoValue(k)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Estimate / deadline */}
                <div className="text-xs text-muted-foreground border-t border-border pt-2">
                  {lifecycle.deadline
                    ? <>Deadline: <span className="text-foreground font-medium">{fmt(lifecycle.deadline)}</span>{' · '}<span className={st.tone === 'bad' ? 'text-red-600' : st.tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}>{st.text}</span></>
                    : 'Không có deadline cho giai đoạn này.'}
                </div>
              </div>
            </li>

            {/* Points CHƯA TỚI */}
            {MAIN_CHAIN.slice(index + 1).map((s) => {
              const est = stageEstimateHrs(s, sla);
              const pb = stagePlaybook(s);
              return (
                <li key={s} className="ml-4 opacity-50">
                  <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-border bg-transparent" />
                  <div className="space-y-0.5">
                    <div className="text-sm text-muted-foreground font-medium">{STAGE_LABELS[s]}</div>
                    {est != null && (
                      <div className="text-xs text-muted-foreground">dự kiến {fmtDuration(est)}</div>
                    )}
                    {pb.whatToDo && (
                      <div className="text-xs text-muted-foreground italic">{pb.whatToDo}</div>
                    )}
                  </div>
                </li>
              );
            })}

            {timelineSteps.length === 0 && (
              <li className="ml-4 text-sm text-muted-foreground">Chưa có mốc nào.</li>
            )}
          </ol>
        </CardContent>
      </Card>

      {/* === 4. PANEL BỔ TRỢ === */}
      <AddressVerifyCard address={address} orderId={orderId} />
      <LarkDetailCard records={larkRecords} />
    </div>
  );
}
