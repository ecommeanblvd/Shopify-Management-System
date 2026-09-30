'use client';

import { Fragment, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CountryFlag } from '@/components/ui/country-flag';
import { LO_TRINH_LOI, NGUONG_HIEN_TUYEN, SO_THANG_NHIN_TUYEN, gomTuyenItKien } from '@/features/shipments/sop-giao-hang';
import { nguongDatKy } from '@/features/kpi-logistics/quy-che';
import type { DongKpiNuoc } from '@/features/shipments/sop-giao-hang';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);

/**
 * Bảng 1.2 theo tuyến — THU GỌN thành một dòng, mở modal khi cần xem (CEO 30/09/2026).
 *
 * Lý do thu gọn: bảng dài hơn hai màn hình mà lúc chấm KPI không ai đọc hết — thứ cần biết là
 * "tuyến nào đang kéo điểm", còn chi tiết từng hãng chỉ xem khi đã thấy tuyến có vấn đề.
 *
 * Dòng tóm tắt vì vậy nêu đúng các tuyến DƯỚI NGƯỠNG, không nêu tổng chung chung: tổng đã có ở
 * bảng tiêu chí phía trên rồi, nhắc lại thì không thêm thông tin nào.
 */
export function BangTuyen12({ ky, tu, cuaSoTuyen, theoNuoc }: {
  ky: string;
  tu: string;
  cuaSoTuyen: { tu: string; den: string };
  theoNuoc: DongKpiNuoc[];
}) {
  const [mo, setMo] = useState(false);
  const nguong = nguongDatKy(tu);
  const tuyen = gomTuyenItKien(theoNuoc);

  // Chỉ tuyến ĐỦ kiện để kết luận mới đáng gọi tên — tuyến lẻ vài kiện đã gộp một dòng.
  const duoiNguong = tuyen.hien
    .filter((d) => d.tyLeDungHan != null && d.tyLeDungHan < nguong)
    .sort((a, b) => (a.tyLeDungHan ?? 0) - (b.tyLeDungHan ?? 0));

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="font-semibold">Tiêu chí 1.2 theo tuyến</span>
        <span className="text-xs text-muted-foreground">
          {theoNuoc.length === 0 ? 'Chưa có kiện nào ghi nhận giao trong kỳ.' : duoiNguong.length === 0 ? (
            <>Không tuyến nào dưới ngưỡng {pct(nguong)} — {tuyen.hien.length} tuyến đủ kiện để kết luận.</>
          ) : (
            <>
              <b className="text-red-600 dark:text-red-400">{duoiNguong.length} tuyến dưới ngưỡng {pct(nguong)}</b>
              {': '}
              {duoiNguong.slice(0, 4).map((d) => `${d.country} ${pct(d.tyLeDungHan)}`).join(' · ')}
              {duoiNguong.length > 4 && ` · và ${duoiNguong.length - 4} tuyến nữa`}
            </>
          )}
        </span>
        {theoNuoc.length > 0 && (
          <button type="button" onClick={() => setMo(true)}
            className="ml-auto cursor-pointer rounded border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted">
            Xem chi tiết từng tuyến
          </button>
        )}
      </div>

      <Dialog open={mo} onOpenChange={setMo}>
        {/* Bề rộng PHẢI đặt bằng `sm:max-w-*`: `max-w-*` thường không đè được `sm:max-w-sm` có
            sẵn trong DialogContent — xem `dialog-max-w.test.ts`. */}
        <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[980px]">
          <div className="border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold">
              Chi tiết tiêu chí 1.2 — từng tuyến, {SO_THANG_NHIN_TUYEN} tháng gần nhất
            </DialogTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {cuaSoTuyen.tu} → {cuaSoTuyen.den} · kỳ chấm {ky} · ngưỡng {pct(nguong)} · lộ trình{' '}
              {LO_TRINH_LOI.map((m) => `${m.nhan} ${Math.round((1 - m.loiToiDa) * 100)}%`).join(' → ')}
            </p>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 z-10 bg-muted/90 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="text-left">Nước / hãng</th><th className="text-right">Cam kết</th>
                  <th className="text-right">Kiện</th><th className="text-right">Đúng hạn</th><th className="text-right">% đúng hạn</th>
                </tr>
              </thead>
              <tbody>
                {tuyen.hien.map((d) => (
                  <Fragment key={d.country}>
                    <tr className="border-t border-border bg-muted/30 font-medium [&>td]:px-3 [&>td]:py-2">
                      <td className="text-left">
                        <span className="inline-flex items-center gap-2"><CountryFlag code={d.country} className="!h-4 !w-6" />{d.country}</span>
                      </td>
                      <td className="text-right">{d.slaNgay} ngày</td>
                      <td className="text-right">{d.n}</td>
                      <td className="text-right">{d.dungHan}</td>
                      <td className={`text-right font-semibold ${(d.tyLeDungHan ?? 0) >= nguong ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{pct(d.tyLeDungHan)}</td>
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
                {tuyen.gop && (
                  <tr className="border-t border-border text-muted-foreground [&>td]:px-3 [&>td]:py-2">
                    <td className="text-left italic">{tuyen.gop.soNuoc} nước dưới {NGUONG_HIEN_TUYEN} kiện</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{tuyen.gop.n}</td>
                    <td className="text-right">{tuyen.gop.dungHan}</td>
                    <td className="text-right">{pct(tuyen.gop.tyLeDungHan)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            Bảng này nhìn {SO_THANG_NHIN_TUYEN} tháng chứ không riêng kỳ chấm: một tháng cho mỗi tuyến quá ít kiện để kết
            luận — T9/2026 tuyến AU có đúng 10 kiện, thêm một kiện trễ là tụt 10 điểm. ĐIỂM SỐ vẫn chấm theo tháng ở bảng
            tiêu chí. Cam kết lấy từ bảng SOP trong Báo cáo ship — theo từng nước, hãng nhanh hơn có thước riêng.
            {tuyen.gop && ` Nước dưới ${NGUONG_HIEN_TUYEN} kiện gộp một dòng: vài kiện lẻ không đủ kết luận một tuyến có vấn đề. Kiện của các nước đó vẫn nằm trong tổng, và bản CSV vẫn có đủ từng nước.`}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
