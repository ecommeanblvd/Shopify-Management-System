import { Card, CardContent } from '@/components/ui/card';
import { NhapKpiForm } from '@/components/kpi/NhapKpiForm';
import { NutChotKy } from '@/components/kpi/NutChotKy';
import { BangTuyen12 } from '@/components/kpi/BangTuyen12';
import { KhuQuanLy } from '@/components/kpi/KhuQuanLy';
import Link from 'next/link';
import { viecChoDuyet } from '@/features/kpi-logistics/cho-duyet';
import { ChiTietPillar1 } from '@/components/kpi/ChiTietPillar1';
import { ChiTietPillar2 } from '@/components/kpi/ChiTietPillar2';
import { docChiTietKpi } from '@/features/kpi-logistics/chi-tiet-actions';
import { docChiTietPillar2, luuSuCo, xoaSuCo, timDonShipHo } from '@/features/ship-ho/pillar2-actions';
import type { SoLieuTuDong } from '@/features/kpi-logistics/queries';
import type { SoChoDuyet } from '@/features/kpi-logistics/cho-duyet-queries';
import type { kpiLogisticsThang } from '@/db/schema';
import { bangDiemKpi, type DongDiem } from '@/features/kpi-logistics/quy-che';

const vnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
/** Nhãn kết quả từ mức đạt: đủ / một phần / mất / chưa chấm được. */
function ketQua(m: number | null): { chu: string; mau: string } {
  if (m == null) return { chu: 'Chưa chấm được', mau: 'text-muted-foreground' };
  if (m >= 1) return { chu: 'Đạt đủ', mau: 'text-emerald-600 dark:text-emerald-400' };
  if (m > 0) return { chu: `Đạt ${Math.round(m * 100)}%`, mau: 'text-amber-600 dark:text-amber-400' };
  return { chu: 'Không đạt', mau: 'text-red-600 dark:text-red-400' };
}

/**
 * Tab KPI Logistics — bảng điểm KPI của nhân sự vận hành theo Quy chế bản 1.2. Chỉ KẾT QUẢ, không quy ra tiền
 * (CEO 10/09/2026: tiền để HR tính). Dữ liệu do trang cha nạp sẵn theo kỳ.
 */
export function KpiTab({ ky, tu, den, auto, nhap, chot, soChoDuyet, nop12, suaDuoc, ganLyDoDuoc, ghiSuCoDuoc }: {
  ky: string; tu: string; den: string;
  auto: SoLieuTuDong;
  nhap: typeof kpiLogisticsThang.$inferSelect | null;
  /** Kỳ đã chốt chưa — `auto`/`nhap` khi đó là ẢNH CHỤP, không phải số sống. */
  chot: { chotAt: string; ghiChu: string | null } | null;
  /** Số liệu cho dải "Chờ quản lý duyệt" và Khu vực quản lý; null khi người xem không phải quản lý. */
  soChoDuyet: SoChoDuyet | null;
  /** Trạng thái nộp lý do giao chậm của kỳ (tiêu chí 1.2). */
  nop12: { trangThai: 'dang_lam' | 'cho_duyet' | 'da_duyet'; nopAt: string | null; duyetAt: string | null; soDongDangTraLai: number } | null;
  /** Chỉ quản lý (admin) mới sửa được các ô nhập tay — người bị chấm chỉ xem. */
  suaDuoc: boolean;
  /** Nhân sự logistics (quyền đối soát phí ship) gán được lý do chậm trên bảng 1.2. */
  ganLyDoDuoc: boolean;
  /** Quyền ghi sự cố ship hộ (manage_ship_ho hoặc admin). */
  ghiSuCoDuoc: boolean;
}) {
  const sla = auto.slaTong;
  const gateDat = nhap?.gateOverride ?? auto.gateDat;
  const thuHoi = nhap?.thuHoiKeToanVnd != null ? Number(nhap.thuHoiKeToanVnd) : auto.thuHoiVnd;
  /* KHÔNG tự chia lại ở đây. Tỉ lệ thực thu phải lấy hai vế từ CÙNG một tập dòng đối soát
   * (`auto.tyLeThuHoi`). Chia tiền credit note cho mức khiếu nại là hai tập khác nhau trên hai
   * trục ngày khác nhau — chính là chỗ ra 241% của tháng 8 (CEO 29/09/2026). Ô nhập tay
   * `thuHoiKeToanVnd` chỉ ghi đè SỐ TIỀN 3C, không đổi được chất lượng đòi nợ. */
  const tyLeThuHoi = auto.tyLeThuHoi;

  const diem = bangDiemKpi({
    // Mặc định lấy số hệ thống ĐÃ chốt là lỗi nội bộ; ô nhập tay chỉ để quản lý ghi đè.
    soDonAmCuocLoi: nhap?.soDonAmCuocLoi ?? auto.soDonAmCuocLoiNoiBo,
    soDonAmCuocChuaXet: auto.soDonAmCuocChuaXet,
    tyLeSla: sla.tyLe,
    tyLeLoiChungTu: auto.tyLeLoiChungTu,
    tyLeSizeThung: nhap?.tyLeSizeThung == null ? auto.sizeThung.tyLeDung : Number(nhap.tyLeSizeThung),
    soDonShipHo: auto.soDonShipHo,
    thietHaiChamDiemVnd: auto.suCo.thietHaiChamDiemVnd,
    gateDat,
    roRiGiam: nhap?.roRiGiam ?? false,
    khacPhucGoc: nhap?.khacPhucGoc ?? false,
    // Có dòng nhập tay = quản lý đã vào chấm kỳ này. Không có dòng thì hai mục 3B để TRỐNG
    // thay vì "Chưa đạt" — bảng `kpi_logistics_thang` rỗng hoàn toàn tính tới 29/09/2026, nên
    // mặc định cũ đang kết tội mọi kỳ cho phần việc chưa ai kiểm.
    daChamP3B: nhap != null,
    thuHoiVnd: thuHoi,
    tyLeThuHoi,
    clawbackVnd: nhap?.clawbackVnd ? Number(nhap.clawbackVnd) : 0,
  }, tu);

  const soTieuChiDat = diem.p1.filter((d) => (d.mucDat ?? 0) >= 1).length;
  /* Dải việc chờ CHỈ dựng cho quản lý: người bị chấm không duyệt được gì, hiện ra chỉ là nhiễu. */
  const choDuyet = soChoDuyet == null ? [] : viecChoDuyet({
    ky, kienChoDuyet: soChoDuyet.kienChoDuyet, monCanChoDuyet: soChoDuyet.monCanChoDuyet,
    daChamP3B: nhap != null, daChot: chot != null,
    p1ChuaCham: diem.p1.filter((d) => d.mucDat == null).length,
    donChuaPhanDinh: auto.soDonAmCuocChuaXet,
  });
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
    <>
      {/* Bốn điểm duyệt nằm bốn nơi và không nơi nào báo là có việc chờ, nên quản lý phải tự nhớ
          mở từng màn. Gom lại một chỗ, nói thẳng còn bao nhiêu và làm ở đâu (CEO 29/09/2026). */}
      {choDuyet.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chờ quản lý duyệt — các lệnh duyệt nằm ở KHU VỰC QUẢN LÝ cuối trang</div>
          <ul className="mt-2 space-y-2">
            {choDuyet.map((v) => (
              <li key={v.ma + v.nhan} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{v.nhan}</span>
                <span className="text-xs text-muted-foreground">{v.huong}</span>
                {v.href && (
                  <Link href={v.href} className="cursor-pointer rounded border border-border px-2 py-0.5 text-xs transition-colors hover:bg-muted">
                    Mở trang
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ở ĐẦU trang chỉ hiện TRẠNG THÁI chốt cho mọi người; nút bấm nằm ở Khu vực quản lý
          cuối trang để quản lý có đúng MỘT chỗ thao tác (CEO 30/09/2026). */}
      <NutChotKy ky={ky} daChot={chot} suaDuoc={false} />

      {/* Tiền đã đòi được nhưng thiếu chứng từ thì KHÔNG vào 3C của tháng nào — trước đây nó
          im lặng biến mất. Hiện thành con số để có người đi tìm tệp (CEO 29/09/2026). */}
      {auto.chungTuThieu.soTo > 0 && (
        <div className="rounded-xl border border-amber-600/40 bg-amber-600/10 px-4 py-2.5 text-sm">
          <b className="text-amber-700 dark:text-amber-400">Thiếu chứng từ credit note: {vnd(auto.chungTuThieu.tienVnd)} đã đòi được chưa vào 3C của tháng nào</b>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Tiền 3C tính theo credit note ĐƯỢC XUẤT trong kỳ, nên tờ nào chưa tải lên thì không tháng nào được tính.
            Còn {auto.chungTuThieu.soTo} tờ ghi trên dòng đối soát mà chưa có tệp trong hệ thống: {auto.chungTuThieu.danhSach.join(', ')}.
            Tải ở trang Đối soát phí ship, tháng tương ứng sẽ tự cộng thêm.
          </div>
        </div>
      )}

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

      <ChiTietPillar1 ky={ky} tu={tu} den={den} tai={docChiTietKpi} ganLyDoDuoc={ganLyDoDuoc} duyetDuoc={suaDuoc} nop12={nop12 ?? undefined} />

      <BangTuyen12 ky={ky} tu={tu} cuaSoTuyen={auto.cuaSoTuyen} theoNuoc={auto.slaTheoNuoc} />

      {bangTieuChi('Pillar 2 — Ship hộ (sản lượng và chất lượng)', diem.p2, false)}

      <ChiTietPillar2 ky={ky} tu={tu} den={den} tai={docChiTietPillar2} luu={luuSuCo} xoa={xoaSuCo} timDon={timDonShipHo} suaDuoc={ghiSuCoDuoc} />
      {bangTieuChi('Pillar 3 — Đối soát & thu hồi công nợ', diem.p3, false)}

      <Card><CardContent className="p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">Số liệu hệ thống tự tính</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {[
                ['Đơn âm cước trong kỳ (hệ thống flag)', `${auto.soDonAmCuoc} đơn · chênh ${vnd(auto.amCuocVnd)}`, `Cước carrier thực trả vượt cước thu của khách. Con số này CHƯA trừ KPI: tiêu chí 1.1 chỉ đếm đơn đã được quản lý chốt là LỖI NỘI BỘ, hiện là ${nhap?.soDonAmCuocLoi ?? auto.soDonAmCuocLoiNoiBo} đơn. Bấm tiêu chí 1.1 ở report chi tiết để xem từng đơn và trạng thái phân định. Số này đã TRỪ ${vnd(auto.thuHoiTruVaoCuocVnd)} carrier trả lại bằng credit note, nhờ đó ${auto.soDonHetAmNhoThuHoi} đơn hết âm và rời danh sách. Trong kỳ này đối soát đã chốt ${auto.soDonAmCuocLoiNoiBo} đơn là lỗi nội bộ, còn ${auto.soDonAmCuocChuaXet} đơn chưa ai xét.`],
                ['SLA giao hàng', `${auto.slaTong.dungHan}/${auto.slaTong.n} = ${pct(auto.slaTong.tyLe)}`, `Chấm theo bảng SOP cam kết từng nước và từng hãng. Đã loại ${auto.slaLoaiTru} kiện chậm vì lý do ngoài tầm kiểm soát (Quy chế mục VII).`],
                ['Đóng đúng size thùng', `${auto.sizeThung.dung + auto.sizeThung.nheHon}/${auto.sizeThung.n} = ${pct(auto.sizeThung.tyLeDung)}`, `Đo bằng lệch giữa cân tính cước của mình và cân carrier charge: lệch từ 0,5 kg là chọn sai thùng (thùng chật, phồng ra). Kỳ này ${auto.sizeThung.saiThung} kiện sai, dôi ${auto.sizeThung.kgDoiRa} kg phải trả thêm.`],
                ['Kiện phát sinh phí sửa địa chỉ / chứng từ', `${auto.kienLoiChungTu}/${auto.kienCoBill} = ${pct(auto.tyLeLoiChungTu)}`, 'Đọc từ khoản address correction trên hoá đơn carrier.'],
                ['Đơn ship hộ đã giao / đã chốt cước', `${auto.soDonShipHo} đơn`, 'Trạng thái delivered, billed hoặc settled trong kỳ.'],
                ['Tồn đọng chưa phân định đối soát', `${auto.kienTonDong} kiện`, `Kiện có hoá đơn từ các kỳ trước mà chưa ai phân định đúng/sai, chỉ tính kiện của MEAN BLVD. Gate đạt khi tồn bằng 0 — hiện ${auto.gateDat ? 'đạt' : 'chưa đạt'}. Đã phân định ${auto.kienDaPhanDinh}/${auto.kienCanPhanDinh} kiện.`],
                ['Thu hồi công nợ carrier', `${vnd(auto.thuHoiVnd)} · chất lượng đòi ${pct(auto.tyLeThuHoi)}`, `TIỀN 3C là tổng ${auto.soCreditNote} credit note ĐƯỢC XUẤT trong kỳ (tải tệp ở trang Đối soát phí ship) — credit note xuất tháng nào thì tính cho tháng đó. CHẤT LƯỢNG ĐÒI là con số khác và đo trên tập khác: ${auto.soDongKhieuNai} dòng đối soát trong kỳ đã xác định hãng sai, khiếu nại ${vnd(auto.thuocDienKhieuNaiVnd)} và đòi về được ${vnd(auto.thuHoiTheoKhieuNaiVnd)}. Hai số này KHÔNG chia cho nhau được — chia nhầm từng ra 241%. Chưa chặn trần từng dòng thì tổng đòi về là ${vnd(auto.thuHoiThoVnd)}.`],
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

      {suaDuoc ? (
      <KhuQuanLy ky={ky} nop12={nop12} kienChoDuyet={soChoDuyet?.danhSachKien ?? []}
        monCanChoDuyet={soChoDuyet?.monCanChoDuyet ?? 0} ganLyDoDuoc={ganLyDoDuoc}>
      <NutChotKy ky={ky} daChot={chot} suaDuoc={suaDuoc} />
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
          soDonLoiNoiBo={auto.soDonAmCuocLoiNoiBo}
          soDonChuaXet={auto.soDonAmCuocChuaXet}
          gateTuDong={auto.gateDat}
          banDau={{
            ky,
            // Bỏ trống = dùng số hệ thống. KHÔNG mặc định 0: 0 là một kết luận, trống là chưa có kết luận.
            soDonAmCuocLoi: nhap?.soDonAmCuocLoi ?? null,
            // 1.4 tự chấm từ lệch cân (chọn sai thùng); ô nhập tay chỉ dùng khi cần ghi đè (miễn trừ theo mục VII).
            tyLeSizeThung: nhap?.tyLeSizeThung == null ? auto.sizeThung.tyLeDung : Number(nhap.tyLeSizeThung),
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
      </KhuQuanLy>
      ) : (
        <Card><CardContent className="p-4 text-[11px] text-muted-foreground">
          Một số tiêu chí cần quản lý xác nhận thủ công (quy trách nhiệm đơn âm cước, miễn trừ size thùng, hai hạng mục
          3B, clawback). Bạn chỉ xem kết quả; muốn khiếu nại thì phản hồi bằng văn bản trong 3 ngày làm việc theo mục XI
          của quy chế.
        </CardContent></Card>
      )}

    </>
  );
}
