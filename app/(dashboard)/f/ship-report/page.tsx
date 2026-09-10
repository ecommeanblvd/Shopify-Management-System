import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { CountryFlag } from '@/components/ui/country-flag';
import { LyDoChamSelect } from '@/components/shipments/LyDoChamSelect';
import { demTheoLyDo } from '@/features/shipments/ly-do-cham';
import { loadShipReport } from '@/features/ship-report/queries';
import { pnlByMonth, pnlBreakdown } from '@/features/ship-report/pnl';
import { surchargeSummary, surchargeTopRoutes, SURCHARGE_LABELS } from '@/features/ship-report/surcharges';
import { getTransitStats, normalizeTransitRange, pivotRoutesByCountry } from '@/features/shipments/transit-stats';
import {
  NHAN_PHAM_VI, NGUONG_DU_LIEU, NGUONG_NGOAI_LE, PHAM_VI, chuanDeXuat, chuanHoaNguong, chuanHoaPhamVi, doPhu,
  docKienGiao, docTieuChuanGiao, gomTheoNuoc, tyLeNgoaiLe, type DongTieuChuan,
} from '@/features/shipments/tieu-chuan-giao';
import { SopTab } from '@/components/ship-report/SopTab';
import { KpiTab } from '@/components/ship-report/KpiTab';
import { docNhapKpi } from '@/features/kpi-logistics/actions';
import { docSoLieuKpi } from '@/features/kpi-logistics/queries';

export const dynamic = 'force-dynamic';

const vnd = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('vi-VN'));
/** ISO-2 → emoji quốc kỳ (regional indicator). */
const flag = (cc: string) => /^[A-Z]{2}$/.test(cc) ? cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '🏳️';
const REGION_VI = new Intl.DisplayNames(['vi'], { type: 'region' });
const countryName = (cc: string) => { try { return REGION_VI.of(cc) ?? cc; } catch { return cc; } };
const SEG_LABEL: Record<string, string> = { total: 'Tổng', shopify: 'Shopify', ship_ho: 'Ship hộ' };
/** Số ngày hiển thị gọn: 6 thay vì 6.0; null → '—'. */
const soNgay = (v: number | null) => (v == null ? '—' : (Number.isInteger(v) ? String(v) : v.toFixed(1)));
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
/** Ô cột Chuẩn: "n ngày" hoặc "ít dữ liệu" khi mẫu chưa đủ. */
const oChuan = (r: DongTieuChuan) => {
  const c = chuanDeXuat(r);
  return c == null ? <span className="text-[11px] font-normal text-muted-foreground">ít dữ liệu</span> : <>{c} ngày</>;
};

type SP = { tab?: string; months?: string; month?: string; sur?: string; days?: string; pv?: string; nn?: string; ky?: string };

/** 12 kỳ gần nhất (tháng lịch, giờ kinh doanh +07) cho tab KPI. */
function cacKy(homNay: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i += 1) out.push(new Date(Date.UTC(homNay.getUTCFullYear(), homNay.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
const bienKy = (ky: string): [string, string] => {
  const [y, m] = ky.split('-').map(Number);
  return [`${ky}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
};

export default async function ShipReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }

  const sp = await searchParams;
  const TABS = ['pnl', 'surcharge', 'transit', 'chuan', 'sop', 'kpi'] as const;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as (typeof TABS)[number]) : 'pnl';
  // Tab KPI là dữ liệu nhân sự → chỉ admin.
  const laAdmin = role === 'admin';
  const monthsBack = [3, 6, 12].includes(Number(sp.months)) ? Number(sp.months) : 6;

  const raw = await loadShipReport(monthsBack);
  const months = pnlByMonth(raw.pnlItems);
  const monthKeys = [...new Set(months.map((r) => r.month))];
  const pickedMonth = sp.month && monthKeys.includes(sp.month) ? sp.month : monthKeys[0] ?? null;
  const breakdown = pickedMonth ? pnlBreakdown(raw.pnlItems, pickedMonth).slice(0, 20) : [];

  // Tab Tốc độ giao: window theo ngày (POD từ bill + tracking), độc lập filter tháng.
  const transitDays = normalizeTransitRange(sp.days);
  const transit = tab === 'transit' ? await getTransitStats(transitDays) : null;
  const transitMatrix = transit ? pivotRoutesByCountry(transit.routes) : null;

  // Tab KPI Logistics: bảng điểm KPI nhân sự theo kỳ tháng lịch (CEO 10/09/2026 — tách khỏi tab SOP).
  // eslint-disable-next-line react-hooks/purity
  const homNay = new Date(Date.now() + 7 * 3600_000);
  const dsKy = cacKy(homNay);
  const kyKpi = sp.ky && dsKy.includes(sp.ky) ? sp.ky : dsKy[1] ?? dsKy[0]; // mặc định tháng trước (kỳ đã chốt)
  const [tuKpi, denKpi] = bienKy(kyKpi);
  const [autoKpi, nhapKpi] = tab === 'kpi' && laAdmin
    ? await Promise.all([docSoLieuKpi(tuKpi, denKpi), docNhapKpi(kyKpi)])
    : [null, null];

  // Tab Tiêu chuẩn giao: toàn bộ lịch sử (mặc định), tách theo line ship × quốc gia (CEO 10/09/2026).
  const phamVi = chuanHoaPhamVi(sp.pv);
  const nguong = chuanHoaNguong(sp.nn);
  const chuan = tab === 'chuan' ? await docTieuChuanGiao(phamVi, nguong) : null;
  const chuanTheoNuoc = chuan ? gomTheoNuoc(chuan.theoNuoc, chuan.theoLineNuoc) : [];

  const surRows = surchargeSummary(raw.surchargeItems, raw.totalShipments);
  const pickedSur = sp.sur && surRows.some((r) => r.type === sp.sur) ? sp.sur : surRows[0]?.type ?? null;
  const topRoutes = pickedSur ? surchargeTopRoutes(raw.surchargeItems, pickedSur) : [];

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ tab, months: String(monthsBack), days: String(transitDays), pv: phamVi, nn: nguong == null ? 'tat-ca' : String(nguong), ky: kyKpi, ...(sp.month ? { month: sp.month } : {}), ...(sp.sur ? { sur: sp.sur } : {}), ...patch });
    return `/f/ship-report?${p.toString()}`;
  };

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Báo cáo ship</h1>
          <p className="text-sm text-muted-foreground">
            P&L mảng vận chuyển (Shopify + ship hộ) và phân tích phụ phí từ bill carrier. Chi phí ưu tiên số bill thực; đơn chưa bill dùng dự tính.
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          {[3, 6, 12].map((m) => (
            <Link key={m} href={qs({ months: String(m) })}
              className={`rounded px-2.5 py-1 ${monthsBack === m ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
              {m} tháng
            </Link>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border text-sm">
        {([['pnl', 'P&L theo tháng'], ['surcharge', 'Phụ phí'], ['transit', 'Tốc độ giao'], ['chuan', 'Tiêu chuẩn giao'], ['sop', 'SOP giao hàng'], ...(laAdmin ? [['kpi', 'KPI Logistics'] as const] : [])] as const).map(([key, label]) => (
          <Link key={key} href={qs({ tab: key })}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label}
          </Link>
        ))}
      </div>

      {tab === 'kpi' ? (
        !laAdmin ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            Bảng KPI là dữ liệu nhân sự — chỉ tài khoản admin xem được.
          </CardContent></Card>
        ) : autoKpi ? (
          <>
            <div className="flex flex-wrap items-center gap-1 text-sm">
              {dsKy.slice(0, 6).map((k) => (
                <Link key={k} href={qs({ ky: k })}
                  className={`rounded px-2.5 py-1 ${kyKpi === k ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
                  {k}
                </Link>
              ))}
              <a href={`/f/kpi-logistics/bang-kpi.csv?ky=${kyKpi}`} className="ml-2 rounded border border-border px-2.5 py-1 hover:bg-muted">Xuất CSV</a>
              <span className="ml-2 text-xs text-muted-foreground">
                Kỳ chấm theo NGÀY GỬI {tuKpi} → {denKpi}. Hoá đơn carrier về trễ nên kỳ vừa kết thúc chốt được từ đầu tháng sau.
              </span>
            </div>
            <KpiTab ky={kyKpi} tu={tuKpi} den={denKpi} auto={autoKpi} nhap={nhapKpi} />
          </>
        ) : null
      ) : tab === 'sop' ? (
        <SopTab />
      ) : tab === 'chuan' && chuan ? (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {PHAM_VI.map((pv) => (
              <Link key={pv} href={qs({ pv })}
                className={`rounded px-2.5 py-1 ${phamVi === pv ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
                {NHAN_PHAM_VI[pv]}
              </Link>
            ))}
            <span className="ml-2 text-xs text-muted-foreground">
              Lọc theo NGÀY GỬI · kiện gửi {chuan.guiTu ?? '—'} → {chuan.guiDen ?? '—'} · ngày giao mới nhất {chuan.giaoMoiNhat ?? '—'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground">Tách ngoại lệ khi quá</span>
            {NGUONG_NGOAI_LE.map((n) => (
              <Link key={n} href={qs({ nn: String(n) })}
                className={`rounded px-2.5 py-1 ${nguong === n ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
                {n} ngày
              </Link>
            ))}
            <Link href={qs({ nn: 'tat-ca' })}
              className={`rounded px-2.5 py-1 ${nguong == null ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
              Không tách
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              Kiện quá ngưỡng gần như luôn là hàng đã tới nơi nhưng không liên hệ được khách, hoặc kẹt thủ tục thông quan — không phải tốc độ của line.
            </span>
          </div>

          {/* Chuẩn chung — con số để cam kết với khách. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-5">
            {[
              { nhan: 'Chuẩn cam kết', so: soNgay(chuanDeXuat(chuan.tong)), phu: '9/10 kiện giao trong ngần này (P90)', dam: true },
              { nhan: 'Thường gặp', so: soNgay(chuan.tong.p50), phu: 'một nửa số kiện nhanh hơn (P50)' },
              { nhan: 'Trung bình', so: soNgay(chuan.tong.tbNgay), phu: 'bị vài kiện kẹt kéo lệch lên' },
              { nhan: 'Kiện tính chuẩn', so: chuan.tong.soTinhChuan.toLocaleString('vi-VN'), phu: `trên ${chuan.tong.soDaGiao.toLocaleString('vi-VN')} kiện đã giao · ${chuan.tong.soDaGui.toLocaleString('vi-VN')} đã gửi (phủ ${pct(doPhu(chuan.tong))})` },
              {
                nhan: 'Ngoại lệ',
                so: nguong == null ? '—' : `${pct(tyLeNgoaiLe(chuan.tong))}`,
                phu: nguong == null
                  ? 'đang không tách — số trên gồm cả kiện kẹt'
                  : `${chuan.tong.soNgoaiLe} kiện quá ${nguong} ngày · chậm nhất ${soNgay(chuan.tong.maxNgoaiLe)} ngày`,
              },
            ].map((t) => (
              <div key={t.nhan} className="space-y-1 bg-card p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t.nhan}</div>
                <div className={`text-2xl font-semibold tabular-nums ${t.dam ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{t.so}</div>
                <div className="text-[11px] leading-snug text-muted-foreground">{t.phu}</div>
              </div>
            ))}
          </div>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Theo line ship</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Line</th><th className="text-right">Đã gửi</th><th className="text-right">Đã giao</th>
                    <th className="text-right" title="Tỉ lệ kiện đã có ngày giao — phần còn lại ops chưa ghi nhận">Phủ</th>
                    <th className="text-right" title="Kiện quá ngưỡng, đã tách khỏi phần tính chuẩn">Ngoại lệ</th>
                    <th className="text-right">TB</th><th className="text-right" title="Một nửa số kiện nhanh hơn mức này">P50</th>
                    <th className="text-right">P75</th><th className="text-right" title="9/10 kiện giao trong mức này">P90</th>
                    <th className="text-right" title="Chậm nhất trong nhóm giao bình thường (đã trừ ngoại lệ)">Chậm nhất</th>
                    <th className="text-right" title="P90 làm tròn lên — mức nên cam kết với khách">Chuẩn</th>
                  </tr>
                </thead>
                <tbody>
                  {chuan.theoLine.filter((l) => l.soDaGiao > 0).map((l) => (
                    <tr key={l.line} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left font-medium uppercase">{l.line}</td>
                      <td className="text-right">{l.soDaGui}</td>
                      <td className="text-right">{l.soDaGiao}</td>
                      <td className="text-right text-muted-foreground">{pct(doPhu(l))}</td>
                      <td className="text-right text-amber-600 dark:text-amber-400">{l.soNgoaiLe === 0 ? '—' : `${l.soNgoaiLe} · ${pct(tyLeNgoaiLe(l))}`}</td>
                      <td className="text-right">{soNgay(l.tbNgay)}</td>
                      <td className="text-right">{soNgay(l.p50)}</td>
                      <td className="text-right">{soNgay(l.p75)}</td>
                      <td className="text-right">{soNgay(l.p90)}</td>
                      <td className="text-right text-muted-foreground">{soNgay(l.maxNgay)}</td>
                      <td className="text-right font-semibold">{oChuan(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Line “?” là kiện chưa gán carrier. Mẫu dưới {NGUONG_DU_LIEU} kiện giao không chốt chuẩn (hiện “ít dữ liệu”).
            </p>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Theo quốc gia × line ship <span className="font-normal text-muted-foreground">({chuanTheoNuoc.length} nước có kiện đã giao)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Quốc gia / line</th><th className="text-right">Đã giao</th>
                    <th className="text-right" title="Kiện quá ngưỡng, đã tách khỏi phần tính chuẩn">Ngoại lệ</th>
                    <th className="text-right">TB</th><th className="text-right">P50</th><th className="text-right">P90</th>
                    <th className="text-right">Chậm nhất</th><th className="text-right">Chuẩn</th>
                  </tr>
                </thead>
                <tbody>
                  {chuanTheoNuoc.map((n) => (
                    <Fragment key={n.tong.country}>
                      <tr className="border-t border-border bg-muted/30 font-medium [&>td]:px-3 [&>td]:py-2">
                        <td className="text-left">
                          <span className="inline-flex items-center gap-2">
                            <CountryFlag code={n.tong.country} className="!h-4 !w-6" />
                            <span>{countryName(n.tong.country)}</span>
                            <span className="text-[11px] font-normal text-muted-foreground">{n.tong.country}</span>
                          </span>
                        </td>
                        <td className="text-right">{n.tong.soDaGiao}</td>
                        <td className="text-right text-amber-600 dark:text-amber-400">{n.tong.soNgoaiLe === 0 ? '—' : n.tong.soNgoaiLe}</td>
                        <td className="text-right">{soNgay(n.tong.tbNgay)}</td>
                        <td className="text-right">{soNgay(n.tong.p50)}</td>
                        <td className="text-right">{soNgay(n.tong.p90)}</td>
                        <td className="text-right text-muted-foreground">{soNgay(n.tong.maxNgay)}</td>
                        <td className="text-right font-semibold text-emerald-600 dark:text-emerald-400">{oChuan(n.tong)}</td>
                      </tr>
                      {n.lines.map((l) => (
                        <tr key={`${n.tong.country}-${l.line}`} className="border-t border-border/40 text-muted-foreground [&>td]:px-3 [&>td]:py-1.5">
                          <td className="pl-10 text-left uppercase text-xs">{l.line}</td>
                          <td className="text-right">{l.soDaGiao}</td>
                          <td className="text-right">{l.soNgoaiLe === 0 ? '—' : l.soNgoaiLe}</td>
                          <td className="text-right">{soNgay(l.tbNgay)}</td>
                          <td className="text-right">{soNgay(l.p50)}</td>
                          <td className="text-right">{soNgay(l.p90)}</td>
                          <td className="text-right">{soNgay(l.maxNgay)}</td>
                          <td className="text-right">{oChuan(l)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>

          {chuan.dsNgoaiLe.length > 0 && (
            <Card><CardContent className="p-0">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">
                Kiện ngoại lệ chậm nhất <span className="font-normal text-muted-foreground">({chuan.dsNgoaiLe.length} kiện đầu · quá {nguong} ngày)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                      <th className="text-left">Đơn</th><th className="text-left">Nước</th><th className="text-left">Line</th>
                      <th className="text-right">Ngày gửi</th><th className="text-right">Ngày giao</th><th className="text-right">Số ngày</th>
                      <th className="text-left">Lý do chậm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chuan.dsNgoaiLe.map((k, i) => (
                      <tr key={`${k.maDon}-${i}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-1.5">
                        <td className="text-left font-mono text-xs">{k.maDon}</td>
                        <td className="text-left text-xs">{k.country}</td>
                        <td className="text-left text-xs uppercase">{k.line}</td>
                        <td className="text-right text-xs text-muted-foreground">{k.ngayGui}</td>
                        <td className="text-right text-xs text-muted-foreground">{k.ngayGiao}</td>
                        <td className="text-right font-medium text-amber-600 dark:text-amber-400">{soNgay(k.soNgay)}</td>
                        <td className="text-left"><LyDoChamSelect shipmentId={k.shipmentId} banDau={k.lyDoCham} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                Chọn lý do ngay ở cột cuối, lưu tức thì. Dấu ◦ là nhóm ngoài tầm kiểm soát của vị trí logistics (Quy chế mục
                VII) nên được loại khỏi KPI nhân sự; dấu • vẫn tính. Chưa gán lý do thì mặc định VẪN tính vào KPI.
                {(() => {
                  const dem = demTheoLyDo(chuan.dsNgoaiLe.map((k) => k.lyDoCham));
                  return dem.length ? <> Trong danh sách này: {dem.map((d) => `${d.ten} ${d.n}`).join(' · ')}.</> : null;
                })()}
              </div>
            </CardContent></Card>
          )}

          <Card><CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
            <div className="text-sm font-semibold text-foreground">Đọc số này cần biết</div>
            <p>
              Số ngày = từ ngày tạo vận đơn (ngày gửi) đến ngày khách nhận. Ngày giao lấy từ Lark (ops nhập), POD trên bill
              carrier và tracking — kiện chưa ai ghi nhận giao thì không vào thống kê.
            </p>
            <p>
              Độ phủ ghi nhận giao theo năm gửi:{' '}
              {chuan.doPhuTheoNam.map((n) => `${n.nam}: ${n.soDaGiao}/${n.soDaGui} kiện (${pct(n.soDaGui ? n.soDaGiao / n.soDaGui : null)})`).join(' · ')}.
              {chuan.doPhuTheoNam.some((n) => n.soDaGui > 0 && n.soDaGiao / n.soDaGui < 0.5) && ' Năm phủ thấp chỉ còn lại kiện có người nhập tay (thường là kiện có vấn đề) nên kéo trung bình lên — nhìn P50/P90 thay vì trung bình.'}
            </p>
            <p>
              {nguong == null
                ? 'Đang KHÔNG tách ngoại lệ nên các số trên gồm cả kiện đã tới nơi mà không giao được — trung bình sẽ dài hơn thực tế.'
                : `Kiện quá ${nguong} ngày được tách riêng: đó gần như luôn là hàng đã tới nơi nhưng không liên hệ được khách để giao, hoặc kẹt thông quan vì thiếu giấy tờ. Đây là việc của ops và của khách, không phải tốc độ line ship, nên không tính vào chuẩn — nhưng tỉ lệ ngoại lệ vẫn phải theo dõi.`}
            </p>
            <p>
              Một phần kiện kẹt hàng trăm ngày là ops đánh dấu giao hàng loạt cùng một ngày, không phải thời gian giao thật.
              Chuẩn lấy theo P90 chứ không theo trung bình hay số chậm nhất.
            </p>
          </CardContent></Card>
        </>
      ) : tab === 'transit' && transit && transitMatrix ? (
        <>
          <div className="flex items-center gap-1 text-sm">
            {[7, 14, 30, 90].map((d) => (
              <Link key={d} href={qs({ days: String(d) })}
                className={`rounded px-2.5 py-1 ${transitDays === d ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
                {d} ngày
              </Link>
            ))}
            <span className="ml-2 text-xs text-muted-foreground">
              Window: đơn tạo vận đơn trong {transitDays} ngày · ngày giao mới nhất: {transit.latestDeliveryAt ? new Date(transit.latestDeliveryAt).toLocaleDateString('vi-VN') : '—'}
            </span>
          </div>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Tốc độ giao trung bình theo quốc gia (ngày)</div>
            {transitMatrix.rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có đơn giao trong window này.</p>
            ) : (
              <div className="grid grid-cols-2 gap-px bg-border/60 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {transitMatrix.rows.map((r) => {
                  const best = Math.min(...transitMatrix.carriers.map((c) => r.byCarrier[c]?.avgDays ?? Infinity));
                  const totalDelivered = transitMatrix.carriers.reduce((s2, c) => s2 + (r.byCarrier[c]?.deliveredN ?? 0), 0);
                  return (
                    <div key={r.country} className="bg-card p-3">
                      <div className="flex items-center gap-2">
                        <CountryFlag code={r.country} className="!h-6 !w-8" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{countryName(r.country)}</div>
                          <div className="text-[10px] text-muted-foreground">{r.country} · {totalDelivered} đơn giao</div>
                        </div>
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs tabular-nums">
                        {transitMatrix.carriers.map((c) => {
                          const cell = r.byCarrier[c];
                          if (!cell) return null;
                          const isBest = cell.avgDays === best && transitMatrix.carriers.filter((k) => r.byCarrier[k]).length > 1;
                          return (
                            <div key={c} className="flex items-baseline justify-between gap-2">
                              <span className="uppercase text-muted-foreground">{c}</span>
                              <span className={isBest ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-medium'}>
                                {cell.avgDays} ngày <span className="font-normal text-muted-foreground">({cell.deliveredN})</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Số ngày = trung bình từ tạo vận đơn đến giao (số đơn đã giao trong ngoặc). Xanh = line nhanh nhất tuyến khi có ≥2 line. Ngày giao lấy từ POD bill carrier + tracking + Lark.
            </p>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Tổng hợp theo carrier</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Carrier</th><th className="text-right">Đã ship</th><th className="text-right">Đã giao</th>
                    <th className="text-right">TB (ngày)</th><th className="text-right">Median (ngày)</th>
                  </tr>
                </thead>
                <tbody>
                  {transit.carriers.map((c) => (
                    <tr key={c.carrierKey} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left uppercase font-medium">{c.carrierKey}</td>
                      <td className="text-right">{c.shippedN}</td>
                      <td className="text-right">{c.deliveredN}</td>
                      <td className="text-right">{c.avgDays ?? '—'}</td>
                      <td className="text-right">{c.medianDays ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </>
      ) : tab === 'pnl' ? (
        <>
          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">P&L theo tháng ({monthsBack} tháng)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Tháng</th><th className="text-left">Segment</th>
                    <th className="text-right">Đơn</th><th className="text-right">Thu</th><th className="text-right">Chi</th>
                    <th className="text-right">Margin</th><th className="text-right">Margin %</th>
                    <th className="text-right" title="% đơn có chi phí từ bill thực">Phủ bill</th>
                  </tr>
                </thead>
                <tbody>
                  {months.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu.</td></tr>
                  ) : months.map((r) => (
                    <tr key={`${r.month}-${r.segment}`}
                      className={`border-t border-border/60 [&>td]:px-3 [&>td]:py-2 ${r.segment === 'total' ? 'bg-muted/30 font-medium' : 'text-muted-foreground'}`}>
                      <td className="text-left">
                        {r.segment === 'total'
                          ? <Link href={qs({ month: r.month })} className={`underline-offset-2 hover:underline ${pickedMonth === r.month ? 'text-primary' : ''}`}>{r.month}</Link>
                          : ''}
                      </td>
                      <td className="text-left">{SEG_LABEL[r.segment]}</td>
                      <td className="text-right">{r.orders}</td>
                      <td className="text-right">{vnd(r.revenueVnd)}</td>
                      <td className="text-right">{vnd(r.costVnd)}</td>
                      <td className={`text-right font-medium ${r.marginVnd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {r.marginVnd >= 0 ? '+' : ''}{vnd(r.marginVnd)}
                      </td>
                      <td className="text-right">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                      <td className="text-right">{r.billedPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Thu Shopify = phí ship khách trả sau giảm (quy VND theo FX store); thu ship hộ = giá thu thực. Click tháng để xem breakdown bên dưới.
            </p>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Breakdown {pickedMonth ?? ''} — carrier × quốc gia (top 20)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Carrier</th><th className="text-left">Quốc gia</th>
                    <th className="text-right">Đơn</th><th className="text-right">Thu</th><th className="text-right">Chi</th>
                    <th className="text-right">Margin</th><th className="text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu.</td></tr>
                  ) : breakdown.map((r) => (
                    <tr key={`${r.carrierKey}-${r.country}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left uppercase">{r.carrierKey}</td>
                      <td className="text-left">{r.country}</td>
                      <td className="text-right">{r.orders}</td>
                      <td className="text-right">{vnd(r.revenueVnd)}</td>
                      <td className="text-right">{vnd(r.costVnd)}</td>
                      <td className={`text-right font-medium ${r.marginVnd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {r.marginVnd >= 0 ? '+' : ''}{vnd(r.marginVnd)}
                      </td>
                      <td className="text-right">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </>
      ) : (
        <>
          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Phụ phí theo loại ({monthsBack} tháng · {raw.totalShipments.toLocaleString('vi-VN')} đơn)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Loại phụ phí</th>
                    <th className="text-right">Tổng</th><th className="text-right">Đơn dính</th>
                    <th className="text-right">% đơn</th><th className="text-right">TB/đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {surRows.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu phụ phí từ bill.</td></tr>
                  ) : surRows.map((r) => (
                    <tr key={r.type} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left">
                        <Link href={qs({ sur: r.type })} className={`underline-offset-2 hover:underline ${pickedSur === r.type ? 'font-medium text-primary' : ''}`}>{r.label}</Link>
                      </td>
                      <td className="text-right font-medium">{vnd(r.totalVnd)}</td>
                      <td className="text-right">{r.shipments}</td>
                      <td className="text-right">{r.pctOfShipments == null ? '—' : `${r.pctOfShipments}%`}</td>
                      <td className="text-right">{vnd(r.avgVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Nguồn: bill carrier (shipment_charges + bill lines ship hộ). Click loại phụ phí để xem top tuyến bên dưới — căn cứ chỉnh quote và đàm phán giá.
            </p>
          </CardContent></Card>

          <Card><CardContent className="p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Top tuyến — {pickedSur ? (SURCHARGE_LABELS[pickedSur] ?? pickedSur) : '—'}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="text-left">Quốc gia</th><th className="text-left">Carrier</th>
                    <th className="text-right">Tổng</th><th className="text-right">Đơn dính</th><th className="text-right">TB/đơn</th>
                  </tr>
                </thead>
                <tbody>
                  {topRoutes.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có dữ liệu.</td></tr>
                  ) : topRoutes.map((r) => (
                    <tr key={`${r.country}-${r.carrierKey}`} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left">{r.country}</td>
                      <td className="text-left uppercase">{r.carrierKey}</td>
                      <td className="text-right font-medium">{vnd(r.totalVnd)}</td>
                      <td className="text-right">{r.shipments}</td>
                      <td className="text-right">{vnd(r.avgVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
