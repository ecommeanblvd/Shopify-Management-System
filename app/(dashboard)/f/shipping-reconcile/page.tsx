import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { kienCuaChungTu } from '@/features/shipments/credit-note-kien';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { reconcileShipmentsWithStatus, pdfBillByShipment } from '@/features/shipments/reconcile-view';
import { filterReconcileRows, reconcileSummary, paginate, countByEffStatus, hangTrongDoiSoat, type ReconcileFilters } from '@/features/shipments/reconcile-filter';
import { listIssueReports } from '@/features/shipments/issue-report-actions';
import { listCarrierErrors, summariseCarrierErrors } from '@/features/shipments/carrier-error-report';
import { listInternalErrors, summariseInternalErrors } from '@/features/shipments/internal-error-report';
import { listUnmatchedBilledTracking, summariseUnmatched } from '@/features/shipments/unmatched-billed';
import { issueInfo } from '@/components/shipping-reconcile/issue-label';
import { ReconcileTable } from '@/components/shipping-reconcile/ReconcileTable';
import { DaiCanChuY } from '@/components/shipping-reconcile/DaiCanChuY';
import { ReconcileIssuesModal, type OpenIssue } from '@/components/shipping-reconcile/ReconcileIssuesModal';
import { ExportCsvMenu } from '@/components/shipping-reconcile/ExportCsvMenu';
import { NutDongBoLark } from '@/components/shipping-reconcile/NutDongBoLark';
import { NutNhatKy } from '@/components/nhat-ky/NutNhatKy';
import { listGiaoTruocNgayGui, tomTatGiaoTruoc } from '@/features/shipments/giao-truoc-ngay-gui';
import { getLatestLarkRun } from '@/features/lark/sync';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

type SP = { refresh?: string; carrier?: string; status?: string; country?: string; minPct?: string; q?: string; page?: string };

export default async function ShippingReconcilePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    redirect('/');
  }

  const [{ rows, computedAt }, reports, carrierErrors, unmatchedBilled, latestLarkRun] = await Promise.all([
    reconcileShipmentsWithStatus({ forceRecompute: sp.refresh === '1' }),
    listIssueReports(),
    listCarrierErrors(),
    listUnmatchedBilledTracking(),
    getLatestLarkRun(),
  ]);
  // Kiện ghi giao TRƯỚC ngày gửi — dữ liệu sai, thường do dòng Lark ghi nhầm mã đơn.
  const giaoTruoc = await listGiaoTruocNgayGui();
  const carrierErrorGroups = summariseCarrierErrors(carrierErrors.filter((r) => r.state === 'approved'));
  const internalErrors = await listInternalErrors();
  const internalErrorGroups = summariseInternalErrors(internalErrors);

  // Danh sách hãng để lọc: SUY TỪ dữ liệu đang có, không gõ cứng (UPS từng bị bỏ sót).
  const hangCo = hangTrongDoiSoat(rows);

  // Lọc + summary + phân trang PHÍA SERVER (chỉ gửi trang đang xem xuống client).
  const filters: ReconcileFilters = {
    carrier: sp.carrier && hangCo.includes(sp.carrier) ? sp.carrier : 'all',
    status: (['pending', 'reconciled', 'ignored', 'carrier_error', 'disputing', 'internal_error', 'credited', 'accepted', 'awaiting_measurement', 'awaiting_billed'] as const).includes(sp.status as never)
      ? (sp.status as ReconcileFilters['status']) : 'all',
    country: sp.country ?? '', minPct: sp.minPct ?? '', q: sp.q ?? '',
  };
  const filteredRows = filterReconcileRows(rows, filters);
  const summary = reconcileSummary(filteredRows);
  const effCounts = countByEffStatus(filteredRows);
  const preBilledCounts = { awaiting_measurement: effCounts.awaiting_measurement, awaiting_billed: effCounts.awaiting_billed };
  const { pageRows, totalPages, safePage } = paginate(filteredRows, Number(sp.page ?? 0) || 0, PAGE_SIZE);
  const pdfMap = await pdfBillByShipment(pageRows.map((r) => r.shipmentId));

  // "Vấn đề & Report" mở: gom đơn PENDING có vấn đề trên TOÀN BỘ rows (không phải trang).
  const groups = new Map<string, OpenIssue>();
  for (const r of rows) {
    if (r.status !== 'pending') continue;
    const info = issueInfo(r);
    if (!info.groupKey || !info.action) continue;
    const g = groups.get(info.groupKey) ?? { groupKey: info.groupKey, carrierKey: r.carrierKey || null, label: info.label, action: info.action, count: 0, sumDelta: 0, samples: [] };
    g.count += 1;
    g.sumDelta += r.deltaVnd ?? 0;
    if (g.samples.length < 4) g.samples.push(r.orderNumber);
    groups.set(info.groupKey, g);
  }
  const openIssues = [...groups.values()].sort((a, b) => Math.abs(b.sumDelta) - Math.abs(a.sumDelta));

  // Credit note đã nhập (tiền thu hồi cộng theo NGÀY HOÁ ĐƠN — CEO 10/09/2026).
  const { rows: cnRows } = await db.execute<{ id: string; so: string; ky: string; ngay: string; tong: string; nd: string | null; ma_tc: unknown; ten: string | null; loai: string }>(sql`
    SELECT c.id, c.so_hoa_don AS so, c.ky_hieu AS ky, c.ngay::text AS ngay, c.tong_cong::text AS tong, c.loai,
           c.noi_dung AS nd, c.ma_tham_chieu AS ma_tc, c.ten_file AS ten
      FROM credit_notes c ORDER BY c.ngay DESC, c.so_hoa_don DESC LIMIT 30;`);
  // Nối chứng từ với kiện bằng mã vận đơn bóc từ nội dung — `credit_note_lines` rỗng nên đếm
  // dòng ở đó chỉ ra "—" mãi mãi (CEO 30/09/2026).
  const noiKien = await kienCuaChungTu(cnRows.map((r) => ({ id: r.id, noiDung: r.nd, maThamChieu: r.ma_tc })));
  const theoId = new Map(noiKien.map((k) => [k.creditNoteId, k]));
  const creditNotes = cnRows.map((r) => ({
    id: r.id, soHoaDon: r.so, kyHieu: r.ky, ngay: r.ngay, tongCong: Number(r.tong), tenFile: r.ten,
    kien: theoId.get(r.id)?.kien ?? [],
    maLa: theoId.get(r.id)?.maLa ?? [],
    vuongMac: theoId.get(r.id)?.vuongMac ?? null,
    loai: r.loai === 'debit' ? ('debit' as const) : ('credit' as const),
  }));
  const { rows: cnThang } = await db.execute<{ thang: string; tong: string; n: string; tong_debit: string; n_debit: string }>(sql`
    SELECT to_char(ngay, 'YYYY-MM') AS thang,
           COALESCE(SUM(ABS(tong_cong)) FILTER (WHERE loai = 'credit'), 0)::text AS tong,
           COUNT(*) FILTER (WHERE loai = 'credit')::text AS n,
           COALESCE(SUM(ABS(tong_cong)) FILTER (WHERE loai = 'debit'), 0)::text AS tong_debit,
           COUNT(*) FILTER (WHERE loai = 'debit')::text AS n_debit
      FROM credit_notes GROUP BY 1 ORDER BY 1 DESC LIMIT 4;`);
  const creditNoteThang = cnThang.map((r) => ({
    thang: r.thang, tong: Number(r.tong), n: Number(r.n), tongDebit: Number(r.tong_debit), nDebit: Number(r.n_debit),
  }));

  const laRows = unmatchedBilled.filter((r) => !r.shipHoCode && !r.returnOfOrderNumber);

  return (
    /* `space-y-3`, KHÔNG phải `space-y-6`: bảy khối xếp dọc với 24px giữa mỗi khối là 144px
       khoảng trắng trước khi thấy bảng — màn này là màn đông số nhất hệ thống, chỗ làm việc
       phải lên gần đầu (CEO 20/10/2026). */
    <div className="space-y-3 p-6">
      {/* Khuôn header chung của mọi module — xem ghi chú ở `f/dong-hang/page.tsx`: tiêu đề
          bên trái, nhóm nút bên phải, nút Nhật ký là phần tử CUỐI.
          Nhóm nút này trước nằm ở hàng riêng dưới bộ lọc; đưa lên đây bỏ được trọn một hàng
          mà không mất nút nào.

          Khác 5 module kia một chỗ: dòng mô tả nằm DƯỚI cả hàng, không nằm trong cột trái.
          Mô tả màn này dài (nó còn mang giờ engine tính + link "Tính lại"), để chung cột
          trái thì nó chiếm hết bề ngang và đẩy nhóm nút xuống một hàng nữa — đúng thứ vừa
          gỡ. Nút Nhật ký vẫn ở y nguyên chỗ cũ: góc phải, thẳng hàng với `<h1>`. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Đối soát phí ship</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ReconcileIssuesModal openIssues={openIssues} reports={reports}
              carrierErrors={carrierErrors} carrierErrorGroups={carrierErrorGroups}
              internalErrorGroups={internalErrorGroups} />
            <ExportCsvMenu carrier={filters.carrier} country={filters.country} />
            <NutDongBoLark />
            {/* Cuối nhóm nút bên phải header — cùng vị trí như 5 module kia (xem ghi chú ở
                `f/dong-hang/page.tsx`). Bảng của màn này là `shipments`. */}
            <NutNhatKy bang="shipments" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          So giá hóa đơn carrier (billed) với giá hệ thống tính, theo từng đơn và từng khoản phí.
          {' '}Số liệu engine tính lúc {computedAt.toLocaleTimeString('vi-VN')}
          {' · '}
          <a href="/f/shipping-reconcile?refresh=1" className="underline hover:text-foreground">Tính lại</a>
        </p>
      </div>

      {/* Ba khối cũ (banner giao-trước, thẻ hoá đơn điều chỉnh, dải tracking chưa khớp) gộp
          thành MỘT hàng chip: cùng bản chất "việc đang chờ xử lý", nay mặc định thu lại. */}
      <DaiCanChuY
        lark={latestLarkRun}
        rows={laRows}
        summary={summariseUnmatched(laRows)}
        shipHoRows={unmatchedBilled.filter((r) => r.shipHoCode)}
        returnRows={unmatchedBilled.filter((r) => r.returnOfOrderNumber)}
        giaoTruoc={giaoTruoc}
        tomTatGiaoTruoc={tomTatGiaoTruoc(giaoTruoc)}
        creditNotes={creditNotes}
        creditNoteThang={creditNoteThang}
      />
      <ReconcileTable
        rows={pageRows} summary={summary} totalPages={totalPages} safePage={safePage} totalFiltered={filteredRows.length}
        filters={filters} hangCo={hangCo}
        pdfMap={pdfMap} preBilledCounts={preBilledCounts}
      />
    </div>
  );
}
