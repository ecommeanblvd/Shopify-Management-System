import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Fragment } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { Card, CardContent } from '@/components/ui/card';
import { NhapKpiForm } from '@/components/kpi/NhapKpiForm';
import { docNhapKpi } from '@/features/kpi-logistics/actions';
import { docSoLieuKpi } from '@/features/kpi-logistics/queries';
import { bangDiemKpi, nguongDatKy, type DongDiem } from '@/features/kpi-logistics/quy-che';
import { LO_TRINH_LOI } from '@/features/shipments/sop-giao-hang';
import { CountryFlag } from '@/components/ui/country-flag';

export const dynamic = 'force-dynamic';

const vnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
/** Nhãn kết quả từ mức đạt: đủ / một phần / mất / chưa chấm được. */
function ketQua(m: number | null): { chu: string; mau: string } {
  if (m == null) return { chu: 'Chưa chấm được', mau: 'text-muted-foreground' };
  if (m >= 1) return { chu: 'Đạt đủ', mau: 'text-emerald-600 dark:text-emerald-400' };
  if (m > 0) return { chu: `Đạt ${Math.round(m * 100)}%`, mau: 'text-amber-600 dark:text-amber-400' };
  return { chu: 'Không đạt', mau: 'text-red-600 dark:text-red-400' };
}
/** 12 kỳ gần nhất tính từ tháng hiện tại (giờ kinh doanh +07). */
function cacKy(homNay: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i += 1) out.push(new Date(Date.UTC(homNay.getUTCFullYear(), homNay.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
const bienKy = (ky: string): [string, string] => {
  const [y, m] = ky.split('-').map(Number);
  return [`${ky}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
};

export default async function KpiLogisticsPage({ searchParams }: { searchParams: Promise<{ ky?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (role !== 'admin') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-sm text-muted-foreground">Bảng KPI gắn với lương nên chỉ tài khoản admin xem được.</p>
      </div>
    );
  }

  const sp = await searchParams;
  // eslint-disable-next-line react-hooks/purity
  const homNay = new Date(Date.now() + 7 * 3600_000);
  const ds = cacKy(homNay);
  const ky = sp.ky && ds.includes(sp.ky) ? sp.ky : ds[1] ?? ds[0]; // mặc định tháng trước (kỳ đã chốt)
  const [tu, den] = bienKy(ky);

  const [auto, nhap] = await Promise.all([docSoLieuKpi(tu, den), docNhapKpi(ky)]);

  const sla = auto.slaTong;
  const gateDat = nhap?.gateOverride ?? auto.gateDat;
  const thuHoi = nhap?.thuHoiKeToanVnd != null ? Number(nhap.thuHoiKeToanVnd) : auto.thuHoiVnd;
  const tyLeThuHoi = auto.thuocDienKhieuNaiVnd > 0 ? thuHoi / auto.thuocDienKhieuNaiVnd : null;

  const diem = bangDiemKpi({
    soDonAmCuocLoi: nhap?.soDonAmCuocLoi ?? 0,
    tyLeSla: sla.tyLe,
    tyLeLoiChungTu: auto.tyLeLoiChungTu,
    tyLeSizeThung: nhap?.tyLeSizeThung == null ? null : Number(nhap.tyLeSizeThung),
    soDonShipHo: auto.soDonShipHo,
    gateDat,
    roRiGiam: nhap?.roRiGiam ?? false,
    khacPhucGoc: nhap?.khacPhucGoc ?? false,
    thuHoiVnd: thuHoi,
    tyLeThuHoi,
    clawbackVnd: nhap?.clawbackVnd ? Number(nhap.clawbackVnd) : 0,
  }, tu);

  const soTieuChiDat = diem.p1.filter((d) => (d.mucDat ?? 0) >= 1).length;
  const the = [
    { nhan: 'Điểm KPI vận hành (Pillar 1)', so: pct(diem.diemP1), chinh: true },
    { nhan: 'Tiêu chí Pillar 1 đạt đủ', so: `${soTieuChiDat}/4` },
    { nhan: 'Ship hộ (Pillar 2)', so: `${auto.soDonShipHo} đơn` },
    { nhan: 'Gate đối soát (Pillar 3)', so: gateDat ? 'Đạt' : 'Chưa đạt' },
    { nhan: 'Thu hồi công nợ', so: vnd(thuHoi) },
  ];

  const bangTieuChi = (tieuDe: string, dong: DongDiem[], coTrongSo: boolean) => (
    <Card><CardContent className="p-0">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">{tieuDe}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th className="text-left">Tiêu chí</th>
              {coTrongSo && <th className="text-right">Trọng số</th>}
              <th className="text-left">Kết quả trong kỳ</th>
              <th className="text-left">Ngưỡng quy chế</th>
              <th className="text-right">Mức đạt</th>
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => {
              const k = ketQua(d.mucDat);
              return (
                <tr key={d.ma} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2 align-top">
                  <td className="text-left font-medium whitespace-nowrap">{d.ma} · {d.ten}</td>
                  {coTrongSo && <td className="text-right tabular-nums text-muted-foreground">{Math.round((d.trongSo ?? 0) * 100)}%</td>}
                  <td className="text-left">{d.soLieu}</td>
                  <td className="text-left text-[11px] text-muted-foreground">{d.nguong}</td>
                  <td className={`text-right font-semibold whitespace-nowrap ${k.mau}`}>{k.chu}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardContent></Card>
  );

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">KPI Logistics Operations Specialist</h1>
          <p className="text-sm text-muted-foreground">
            Kết quả KPI theo Quy chế bản 1.2. Số liệu lấy thẳng từ hệ thống và hoá đơn carrier; phần hệ thống không tự biết
            thì nhập ở cuối trang. Kỳ chấm là tháng lịch, lọc theo ngày gửi hàng.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {ds.slice(0, 6).map((k) => (
            <Link key={k} href={`/f/kpi-logistics?ky=${k}`}
              className={`rounded px-2.5 py-1 ${ky === k ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>
              {k}
            </Link>
          ))}
          <a href={`/f/kpi-logistics/bang-kpi.csv?ky=${ky}`} className="ml-2 rounded border border-border px-2.5 py-1 hover:bg-muted">Xuất CSV</a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-5">
        {the.map((t) => (
          <div key={t.nhan} className="space-y-1 bg-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t.nhan}</div>
            <div className={`tabular-nums font-semibold ${t.chinh ? 'text-2xl text-emerald-600 dark:text-emerald-400' : 'text-lg'}`}>{t.so}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        Kỳ {ky} ({tu} → {den}). Report này chỉ đo KẾT QUẢ KPI; quy ra tiền thưởng theo quy chế là phần của HR.
      </div>

      {bangTieuChi('Pillar 1 — KPI vận hành & bảo toàn chi phí', diem.p1, true)}
      <Card><CardContent className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Chi tiết tiêu chí 1.2 — từng nước</span>
          <span className="text-[11px] text-muted-foreground">
            Ngưỡng kỳ này {Math.round(nguongDatKy(tu) * 1000) / 10}% · lộ trình {LO_TRINH_LOI.map((m) => `${m.nhan} ${Math.round((1 - m.loiToiDa) * 100)}%`).join(' → ')}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Nước / hãng</th><th className="text-right">Cam kết</th>
                <th className="text-right">Kiện</th><th className="text-right">Đúng hạn</th><th className="text-right">% đúng hạn</th>
              </tr>
            </thead>
            <tbody>
              {auto.slaTheoNuoc.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Chưa có kiện nào ghi nhận giao trong kỳ.</td></tr>
              )}
              {auto.slaTheoNuoc.map((d) => (
                <Fragment key={d.country}>
                  <tr className="border-t border-border bg-muted/30 font-medium [&>td]:px-3 [&>td]:py-2">
                    <td className="text-left">
                      <span className="inline-flex items-center gap-2"><CountryFlag code={d.country} className="!h-4 !w-6" />{d.country}</span>
                    </td>
                    <td className="text-right">{d.slaNgay} ngày</td>
                    <td className="text-right">{d.n}</td>
                    <td className="text-right">{d.dungHan}</td>
                    <td className={`text-right font-semibold ${(d.tyLeDungHan ?? 0) >= nguongDatKy(tu) ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{pct(d.tyLeDungHan)}</td>
                  </tr>
                  {d.theoLine.map((l) => (
                    <tr key={`${d.country}-${l.line}`} className="border-t border-border/30 text-muted-foreground [&>td]:px-3 [&>td]:py-1.5">
                      <td className="pl-10 text-left text-xs uppercase">{l.line}</td>
                      <td className="text-right">{l.slaNgay} ngày</td>
                      <td className="text-right">{l.n}</td>
                      <td className="text-right">{l.dungHan}</td>
                      <td className="text-right">{pct(l.tyLeDungHan)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Cam kết lấy từ bảng SOP trong Báo cáo ship — theo từng nước, hãng nhanh hơn có thước riêng. Ngưỡng đạt siết dần
          theo lộ trình ở trên nên cùng một kết quả sẽ khó đạt hơn ở các quý sau.
        </p>
      </CardContent></Card>

      {bangTieuChi('Pillar 2 — Ship hộ (sản lượng)', diem.p2, false)}
      {bangTieuChi('Pillar 3 — Đối soát & thu hồi công nợ', diem.p3, false)}

      <Card><CardContent className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">Số liệu hệ thống tự tính</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {[
                ['Đơn âm cước trong kỳ (hệ thống flag)', `${auto.soDonAmCuoc} đơn · chênh ${vnd(auto.amCuocVnd)}`, 'Cước carrier thực trả vượt cước thu của khách. Cần quản lý quy trách nhiệm trước khi trừ KPI.'],
                ['SLA giao hàng', `${auto.slaTong.dungHan}/${auto.slaTong.n} = ${pct(auto.slaTong.tyLe)}`, 'Chấm theo bảng SOP cam kết từng nước và từng hãng (Báo cáo ship → SOP & KPI).'],
                ['Kiện phát sinh phí sửa địa chỉ / chứng từ', `${auto.kienLoiChungTu}/${auto.kienCoBill} = ${pct(auto.tyLeLoiChungTu)}`, 'Đọc từ khoản address correction trên hoá đơn carrier.'],
                ['Đơn ship hộ đã giao / đã chốt cước', `${auto.soDonShipHo} đơn`, 'Trạng thái delivered, billed hoặc settled trong kỳ.'],
                ['Tồn đọng chưa phân định đối soát', `${auto.kienTonDong} kiện`, `Kiện có hoá đơn từ các kỳ trước mà chưa ai phân định đúng/sai. Gate đạt khi tồn bằng 0 — hiện ${auto.gateDat ? 'đạt' : 'chưa đạt'}.`],
                ['Thu hồi công nợ carrier', `${vnd(auto.thuHoiVnd)} / thuộc diện ${vnd(auto.thuocDienKhieuNaiVnd)} = ${pct(auto.thuocDienKhieuNaiVnd > 0 ? auto.thuHoiVnd / auto.thuocDienKhieuNaiVnd : null)}`, 'Tiền credit note đã ghi nhận trong kỳ trên tổng tiền đã xác định hãng sai.'],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2 align-top">
                  <td className="text-left font-medium">{a}</td>
                  <td className="text-right whitespace-nowrap">{b}</td>
                  <td className="text-left text-[11px] text-muted-foreground">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-4 p-4">
        <div>
          <div className="text-sm font-semibold">Nhập phần hệ thống không tự biết — kỳ {ky}</div>
          <p className="text-[11px] text-muted-foreground">
            Lưu theo kỳ, lần sau mở lại không phải nhập lại.
            {nhap?.updatedAt ? ` Cập nhật lần cuối ${new Date(nhap.updatedAt).toLocaleString('vi-VN')}.` : ' Kỳ này chưa nhập gì.'}
          </p>
        </div>
        <NhapKpiForm
          ky={ky}
          soDonAmCuocGoiY={auto.soDonAmCuoc}
          gateTuDong={auto.gateDat}
          banDau={{
            ky,
            soDonAmCuocLoi: nhap?.soDonAmCuocLoi ?? 0,
            tyLeSizeThung: nhap?.tyLeSizeThung == null ? null : Number(nhap.tyLeSizeThung),
            roRiGiam: nhap?.roRiGiam ?? false,
            khacPhucGoc: nhap?.khacPhucGoc ?? false,
            gateOverride: nhap?.gateOverride ?? null,
            gateGhiChu: nhap?.gateGhiChu ?? null,
            thuHoiKeToanVnd: nhap?.thuHoiKeToanVnd == null ? null : Number(nhap.thuHoiKeToanVnd),
            clawbackVnd: nhap?.clawbackVnd ? Number(nhap.clawbackVnd) : 0,
            nguonSla: 'sop',
            ghiChu: nhap?.ghiChu ?? null,
          }}
        />
      </CardContent></Card>
    </div>
  );
}
