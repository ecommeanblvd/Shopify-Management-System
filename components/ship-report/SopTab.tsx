import { CountryFlag } from '@/components/ui/country-flag';
import { Card, CardContent } from '@/components/ui/card';
import { CAM_KET_NUOC, LO_TRINH_LOI, MIEN_SOP, mienCuaNuoc } from '@/features/shipments/sop-giao-hang';

const REGION_VI = new Intl.DisplayNames(['vi'], { type: 'region' });
const tenNuoc = (cc: string) => { try { return REGION_VI.of(cc) ?? cc; } catch { return cc; } };

/**
 * Tab SOP — chỉ BẢNG CAM KẾT: giao trong bao nhiêu ngày ở từng nước, thước riêng của từng hãng, và lộ trình siết tỉ lệ
 * lỗi. Kết quả chấm nằm ở tab KPI (CEO 10/09/2026: tách SOP và KPI ra hai chỗ).
 */
export function SopTab() {
  const nuocs = Object.entries(CAM_KET_NUOC)
    .map(([country, ck]) => ({ country, ...ck }))
    .sort((a, b) => a.slaNgay - b.slaNgay || a.country.localeCompare(b.country));

  return (
    <>
      <Card><CardContent className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Cam kết thời gian giao theo từng nước</span>
          <span className="text-[11px] text-muted-foreground">Tính từ ngày tạo vận đơn đến ngày khách nhận</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Nước</th>
                <th className="text-right" title="Số ngày nói với khách">Cam kết</th>
                <th className="text-left" title="Hãng nhanh hơn mặt bằng tuyến bị chấm bằng thước riêng">Thước riêng theo hãng</th>
                <th className="text-left">Căn cứ (dữ liệu 2026)</th>
              </tr>
            </thead>
            <tbody>
              {nuocs.map((n) => (
                <tr key={n.country} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2 align-top">
                  <td className="text-left whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <CountryFlag code={n.country} className="!h-4 !w-6" />
                      <span className="font-medium">{tenNuoc(n.country)}</span>
                      <span className="text-[11px] text-muted-foreground">{mienCuaNuoc(n.country).ten}</span>
                    </span>
                  </td>
                  <td className="text-right font-semibold whitespace-nowrap">{n.slaNgay} ngày</td>
                  <td className="text-left whitespace-nowrap">
                    {n.theoLine
                      ? Object.entries(n.theoLine).map(([line, sla]) => (
                          <span key={line} className="mr-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            <span className="uppercase">{line}</span> <span className="font-medium">{sla} ngày</span>
                          </span>
                        ))
                      : <span className="text-[11px] text-muted-foreground">dùng chung mức của nước</span>}
                  </td>
                  <td className="text-left text-[11px] text-muted-foreground">{n.canCu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Nước chưa đủ 10 kiện đã giao thì dùng mức mặc định của miền: {MIEN_SOP.map((m) => `${m.ten} ${m.slaNgay} ngày`).join(' · ')}.
        </p>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">Lộ trình siết tỉ lệ lỗi cho phép</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="text-left">Kỳ áp dụng</th><th className="text-right">Lỗi tối đa</th>
                <th className="text-right">Ngưỡng đúng hạn phải đạt</th>
              </tr>
            </thead>
            <tbody>
              {LO_TRINH_LOI.map((m) => (
                <tr key={m.tu} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
                  <td className="text-left">{m.nhan}</td>
                  <td className="text-right">{Math.round(m.loiToiDa * 100)}%</td>
                  <td className="text-right font-medium">{Math.round((1 - m.loiToiDa) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Cam kết đặt ngắn như một tuyến express nên tỉ lệ lỗi mở rộng lúc khởi động rồi siết dần. Hệ thống tự lấy ngưỡng
          của kỳ đang chấm, sang quý mới KPI tự chặt hơn mà không cần chỉnh tay.
        </p>
      </CardContent></Card>
    </>
  );
}
