'use client';

import { useState, useTransition } from 'react';
import { csvBody, type CsvValue } from '@/lib/csv';
import { LyDoChamSelect } from '@/components/shipments/LyDoChamSelect';
import { NutGiaiTrinh, NhanTrachNhiem } from './GiaiTrinhAmCuoc';
import { dauHieu, layLyDoAmCuoc, thieuSanPham, NHAN_THUOC_VE_AM_CUOC } from '@/features/kpi-logistics/giai-trinh-am-cuoc';
import { layLyDo } from '@/features/shipments/ly-do-cham';
import {
  TEN_TIEU_CHI, NHAN_KET_QUA_SLA, PHAM_VI_THEO_MA, demKetQuaSla, laCoVanDe, laSizeCoVanDe, xepChoCsv, canGiaiTrinh, conViec, laLoiNoiBo,
  type ChiTietKpi, type MaTieuChi,
} from '@/features/kpi-logistics/chi-tiet';

const MA_LIST: MaTieuChi[] = ['1.1', '1.2', '1.3', '1.4'];
const vnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const kg = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100) / 100}`);

/** Tải bảng đang xem về máy để gửi kèm khiếu nại / đối chiếu với quản lý. */
function taiCsv(ten: string, header: string[], rows: CsvValue[][]) {
  const blob = new Blob(['﻿' + csvBody(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = ten; a.click();
  URL.revokeObjectURL(url);
}

/**
 * Report chi tiết từng tiêu chí Pillar 1: liệt kê ĐÚNG các đơn/kiện tạo nên con số
 * KPI (CEO 11/09/2026). Nạp lười — chọn tiêu chí nào mới truy vấn tiêu chí đó.
 */
export function ChiTietPillar1({ tu, den, ky, tai, ganLyDoDuoc }: {
  tu: string; den: string; ky: string;
  tai: (ma: MaTieuChi, tu: string, den: string) => Promise<ChiTietKpi>;
  /** Nhân sự có quyền đối soát phí ship mới gán được lý do chậm ngay trên bảng. */
  ganLyDoDuoc: boolean;
}) {
  const [ma, setMa] = useState<MaTieuChi | null>(null);
  const [kho, setKho] = useState<Partial<Record<MaTieuChi, ChiTietKpi>>>({});
  const [loi, setLoi] = useState<string | null>(null);
  const [dangTai, start] = useTransition();

  const chon = (m: MaTieuChi) => {
    if (ma === m) { setMa(null); return; }
    setMa(m); setLoi(null);
    if (kho[m]) return;
    start(async () => {
      try {
        const d = await tai(m, tu, den);
        setKho((k) => ({ ...k, [m]: d }));
      } catch (e) {
        setLoi(String((e as Error).message ?? e));
      }
    });
  };

  /** Nạp lại một tiêu chí sau khi đổi dữ liệu (gán lý do chậm có thể đổi cả kết quả chấm). */
  const taiLai = (m: MaTieuChi) => start(async () => {
    try {
      const d = await tai(m, tu, den);
      setKho((k) => ({ ...k, [m]: d }));
    } catch (e) {
      setLoi(String((e as Error).message ?? e));
    }
  });

  const data = ma ? kho[ma] : undefined;

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Report chi tiết từng tiêu chí Pillar 1</div>
          <p className="text-[11px] text-muted-foreground">Bấm một tiêu chí để xem đúng những đơn và kiện làm nên con số ở bảng trên. Phạm vi chấm khác nhau theo tiêu chí — chọn tiêu chí để xem.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MA_LIST.map((m) => (
            <button key={m} type="button" onClick={() => chon(m)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${ma === m ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border hover:bg-muted'}`}>
              {m} · {TEN_TIEU_CHI[m]}
            </button>
          ))}
        </div>
      </div>

      {dangTai && <p className="px-4 py-3 text-xs text-muted-foreground animate-pulse">Đang lấy dữ liệu…</p>}
      {loi && <p className="px-4 py-3 text-xs text-red-600 dark:text-red-400">{loi}</p>}
      {!ma && !dangTai && <p className="px-4 py-3 text-xs text-muted-foreground">Chưa chọn tiêu chí nào.</p>}

      {ma && data && !dangTai && (
        <div className="space-y-3 p-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{data.cachDo} {PHAM_VI_THEO_MA[ma]}</p>
          {data.amCuoc && <BangAmCuoc rows={data.amCuoc} ky={ky} giaiTrinhDuoc={ganLyDoDuoc} sauKhiLuu={() => taiLai('1.1')} />}
          {data.sla && <BangSla rows={data.sla} ky={ky} ganLyDoDuoc={ganLyDoDuoc} sauKhiLuu={() => taiLai('1.2')} />}
          {data.chungTu && <BangChungTu rows={data.chungTu} ky={ky} />}
          {data.sizeThung && <BangSize rows={data.sizeThung} ky={ky} />}
        </div>
      )}
    </section>
  );
}

function Khung({ tomTat, onCsv, nut, children }: {
  tomTat: React.ReactNode; onCsv: () => void; nut?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs">{tomTat}</div>
        <div className="flex items-center gap-1.5">
          {nut}
          <button type="button" onClick={onCsv} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted">
            Tải CSV
          </button>
        </div>
      </div>
      <div className="max-h-[26rem] overflow-auto rounded-md border border-border">
        <table className="w-full text-xs tabular-nums">{children}</table>
      </div>
    </div>
  );
}

/** Nút bật/tắt xem cả kiện đạt. Nói rõ đang giấu bao nhiêu dòng để không ai tưởng bảng chỉ có thế. */
function NutHienHet({ hienHet, doi, an, nhanAn = 'đơn đạt' }: { hienHet: boolean; doi: () => void; an: number; nhanAn?: string }) {
  if (an <= 0 && !hienHet) return null;
  return (
    <button type="button" onClick={doi}
      className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted">
      {hienHet ? 'Chỉ hiện việc còn phải làm' : `Hiện cả ${an} ${nhanAn}`}
    </button>
  );
}

const TH = 'sticky top-0 z-10 bg-muted/90 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur';

function BangAmCuoc({ rows, ky, giaiTrinhDuoc, sauKhiLuu }: {
  rows: NonNullable<ChiTietKpi['amCuoc']>; ky: string; giaiTrinhDuoc: boolean; sauKhiLuu: () => void;
}) {
  const tong = rows.reduce((s, r) => s + r.chenhVnd, 0);
  const daChot = rows.filter(laLoiNoiBo).length;
  const conPhai = rows.filter(canGiaiTrinh);
  // Lỗi cân web đã rõ trách nhiệm nhưng chưa chỉ ra MÓN nào sai — chưa sửa được cân.
  const thieuMon = rows.filter((r) => !r.phanDinh && thieuSanPham(r.giaiTrinh?.lyDo, r.giaiTrinh?.chiTiet));
  const daThuHoi = rows.reduce((s, r) => s + r.thuHoiVnd, 0);
  // Màn hình để XỬ LÝ: mặc định chỉ đơn còn việc; CSV luôn đủ (nguyên tắc 14/09/2026).
  const [hienHet, setHienHet] = useState(false);
  const hien = hienHet ? rows : rows.filter(conViec);
  const choCsv = [...rows].sort((a, b) => Number(canGiaiTrinh(a)) - Number(canGiaiTrinh(b)) || b.chenhVnd - a.chenhVnd);
  return (
    <Khung
      tomTat={<><b>{rows.length}</b> đơn còn âm cước sau khi trừ tiền đã đòi lại · tổng chênh <b>{vnd(tong)}</b> · đã đòi lại được <b>{vnd(daThuHoi)}</b> · đã chốt lỗi nội bộ <b>{daChot}</b> · <span className={conPhai.length ? 'text-amber-600 dark:text-amber-400' : ''}>còn phải giải trình <b>{conPhai.length}</b></span>{thieuMon.length > 0 && <> · <span className="text-amber-600 dark:text-amber-400">lỗi cân web chưa chọn món sai <b>{thieuMon.length}</b></span></>}. Đơn đang khiếu nại hãng thì xử lý ở Đối soát phí ship. Đơn âm vì cân web thấp → <a href="/f/can-san-pham" className="underline">Sửa cân sản phẩm</a>.</>}
      onCsv={() => taiCsv(`kpi-${ky}-1.1-am-cuoc.csv`,
        ['Đơn', 'Nước', 'Ngày gửi', 'Khách trả (VND)', 'Carrier bill (VND)', 'Đã đòi lại (VND)', 'Giá vốn ròng (VND)', 'Chênh (VND)',
          'Phân định đối soát', 'Số credit note', 'Dấu hiệu hệ thống', 'Hệ thống gợi ý', 'Nguyên nhân giải trình', 'Trách nhiệm',
          'Số món trong đơn', 'Món sai cân = cân đúng', 'Phụ phí (VND)', 'Line HNC', 'Ghi chú'],
        choCsv.map((r) => {
          const g = r.giaiTrinh;
          const monSai = g?.chiTiet.sanPhamSai?.map((x) => `${x.sku}=${x.canMoiG / 1000}kg`).join(' | ') ?? g?.chiTiet.skuCanSua ?? null;
          return [r.maDon, r.nuoc, r.ngayGui, r.thuKhachVnd, r.carrierVnd, r.thuHoiVnd, r.carrierRongVnd, r.chenhVnd,
            r.phanDinh, r.soCreditNote, dauHieu(r.tinHieu).join(' | '), layLyDoAmCuoc(r.goiY)?.ten ?? r.goiY,
            g ? (layLyDoAmCuoc(g.lyDo)?.ten ?? g.lyDo) : null,
            g ? (NHAN_THUOC_VE_AM_CUOC[g.thuocVe as keyof typeof NHAN_THUOC_VE_AM_CUOC] ?? g.thuocVe) : null,
            g?.chiTiet.soDo ?? null, monSai, g?.chiTiet.phiVnd ?? null,
            g?.chiTiet.lineHnc ? 'Có' : null, g?.ghiChu ?? null];
        }))}
      nut={<NutHienHet hienHet={hienHet} doi={() => setHienHet(!hienHet)} an={rows.length - hien.length} nhanAn="đơn đã phân định" />}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Nước</th><th className={`${TH} text-left`}>Ngày gửi</th>
        <th className={`${TH} text-right`}>Khách trả</th><th className={`${TH} text-right`}>Giá vốn ròng</th>
        <th className={`${TH} text-right`}>Chênh</th><th className={`${TH} text-left`}>Dấu hiệu</th>
        <th className={`${TH} text-left`}>Phân định</th><th className={`${TH} text-right`}></th>
      </tr></thead>
      <tbody>
        {hien.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">{rows.length === 0 ? 'Không đơn nào còn âm cước sau giảm trừ.' : 'Mọi đơn âm cước đã được phân định.'}</td></tr>}
        {hien.map((r) => {
          const g = r.giaiTrinh;
          return (
            <tr key={r.orderId} className="border-t border-border/50 align-top">
              <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-left">{r.nuoc ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-left">{r.ngayGui ?? '—'}</td>
              <td className="px-2.5 py-1.5 text-right">{vnd(r.thuKhachVnd)}</td>
              <td className="px-2.5 py-1.5 text-right">{vnd(r.carrierRongVnd)}{r.thuHoiVnd > 0 && <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">đã đòi −{vnd(r.thuHoiVnd)}</span>}</td>
              <td className="px-2.5 py-1.5 text-right font-semibold text-red-600 dark:text-red-400">{vnd(r.chenhVnd)}</td>
              <td className="px-2.5 py-1.5 text-left text-[11px] text-muted-foreground">{dauHieu(r.tinHieu).join(' · ') || '—'}</td>
              <td className="px-2.5 py-1.5 text-left">
                {r.phanDinh
                  ? <span className="text-muted-foreground">{r.phanDinh}{r.soCreditNote ? ` · ${r.soCreditNote}` : ''}</span>
                  : g
                    ? <span className="space-y-0.5">
                        <span className="block text-xs">{layLyDoAmCuoc(g.lyDo)?.ten ?? g.lyDo}</span>
                        <NhanTrachNhiem thuocVe={g.thuocVe} />
                        {g.chiTiet.sanPhamSai?.map((x) => (
                          <span key={x.sku} className="block font-mono text-[10px] text-muted-foreground">{x.sku} → {x.canMoiG / 1000}kg</span>
                        ))}
                        {thieuSanPham(g.lyDo, g.chiTiet) && <span className="block text-[10px] font-medium text-amber-600 dark:text-amber-400">chưa chọn món sai cân</span>}
                      </span>
                    : <span className="text-amber-600 dark:text-amber-400">chưa phân định</span>}
              </td>
              <td className="px-2.5 py-1.5 text-right">
                {giaiTrinhDuoc && !r.phanDinh && <NutGiaiTrinh dong={r} sauKhiLuu={sauKhiLuu} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Khung>
  );
}

function BangSla({ rows, ky, ganLyDoDuoc, sauKhiLuu }: {
  rows: NonNullable<ChiTietKpi['sla']>; ky: string; ganLyDoDuoc: boolean; sauKhiLuu: () => void;
}) {
  const d = demKetQuaSla(rows);
  // Màn hình để XỬ LÝ nên mặc định chỉ hiện kiện có vấn đề; CSV vẫn đầy đủ (CEO 14/09/2026).
  const [hienHet, setHienHet] = useState(false);
  const hien = hienHet ? rows : rows.filter((r) => laCoVanDe(r.ketQua));
  const mau: Record<string, string> = {
    dat: 'text-emerald-600 dark:text-emerald-400',
    tre: 'text-amber-600 dark:text-amber-400',
    ngoai_le: 'text-red-600 dark:text-red-400',
    loai_tru: 'text-muted-foreground',
    chua_den_han: 'text-muted-foreground',
  };
  return (
    <Khung
      tomTat={<><b>{d.dat}</b> đạt · <b>{d.tre}</b> trễ · <b>{d.ngoai_le}</b> trễ nặng · <b>{d.loai_tru}</b> loại khỏi KPI · <b>{d.chua_den_han}</b> chưa tới hạn (chưa giao, còn trong cam kết — đứng ngoài mẫu số) · tỉ lệ đạt <b>{d.tyLeDat == null ? '—' : `${Math.round(d.tyLeDat * 1000) / 10}%`}</b> trên {d.tinhKpi} kiện. Cột Thước hãng là mức nội bộ chặt hơn của hãng; dấu ⚑ là kiện đạt cam kết với khách nhưng chậm so với thước hãng, không trừ điểm.{ganLyDoDuoc ? ' Chọn lý do chậm ngay ở cột cuối; lý do thuộc nhóm ngoài tầm kiểm soát sẽ tự rời mẫu số chấm điểm.' : ''}</>}
      onCsv={() => taiCsv(`kpi-${ky}-1.2-sla.csv`,
        ['Thuộc', 'Đơn', 'Tracking', 'Nước', 'Hãng', 'Ngày gửi', 'Ngày giao', 'Số ngày', 'Cam kết nước', 'Thước hãng', 'Kết quả', 'Lý do chậm'],
        xepChoCsv(rows).map((r) => [r.thuocVe, r.maDon, r.tracking, r.nuoc, r.line, r.ngayGui, r.ngayGiao, r.soNgay, r.slaNgay, r.slaLineNgay, NHAN_KET_QUA_SLA[r.ketQua], r.lyDoCham ? (layLyDo(r.lyDoCham)?.ten ?? r.lyDoCham) : null]))}
      nut={<NutHienHet hienHet={hienHet} doi={() => setHienHet(!hienHet)} an={rows.length - hien.length} />}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Thuộc</th>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Tracking</th>
        <th className={`${TH} text-left`}>Nước</th><th className={`${TH} text-left`}>Hãng</th>
        <th className={`${TH} text-left`}>Gửi</th><th className={`${TH} text-left`}>Giao</th>
        <th className={`${TH} text-right`}>Ngày</th><th className={`${TH} text-right`}>Cam kết</th><th className={`${TH} text-right`}>Thước hãng</th>
        <th className={`${TH} text-left`}>Kết quả</th><th className={`${TH} text-left`}>Lý do chậm</th>
      </tr></thead>
      <tbody>
        {hien.length === 0 && <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">{rows.length === 0 ? 'Chưa có kiện nào trong kỳ.' : 'Không kiện nào có vấn đề — mọi kiện đều đạt cam kết.'}</td></tr>}
        {hien.map((r, i) => (
          <tr key={i} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left text-muted-foreground">{r.thuocVe}</td>
            <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left font-mono text-[10px]">{r.tracking ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.nuoc}</td>
            <td className="px-2.5 py-1.5 text-left uppercase">{r.line}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGiao || <span className="text-muted-foreground">chưa giao</span>}</td>
            <td className="px-2.5 py-1.5 text-right font-semibold">{r.soNgay}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{r.slaNgay}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{r.slaLineNgay}{r.slaLineNgay < r.slaNgay && r.soNgay > r.slaLineNgay ? ' ⚑' : ''}</td>
            <td className={`px-2.5 py-1.5 text-left font-medium ${mau[r.ketQua]}`}>{NHAN_KET_QUA_SLA[r.ketQua]}</td>
            <td className="px-2.5 py-1.5 text-left">
              {/* Kiện ĐẠT cam kết thì không có gì để giải thích — hiện ô chọn ở đó chỉ mời người
                  ta bấm nhầm, mà bấm nhầm là rút một kiện tốt khỏi mẫu số.
                  Kiện bị loại vì NƯỚC (VN nội địa) cũng không cần: gán lý do gì nó cũng đã
                  đứng ngoài mẫu số. Nhưng kiện bị loại vì CHÍNH LÝ DO đã gán thì vẫn cho sửa,
                  nếu không thì gán nhầm một lần là kẹt luôn, không gỡ ra được. */}
              {ganLyDoDuoc && r.shipmentId
                && r.ketQua !== 'dat' && r.ketQua !== 'chua_den_han'
                && !(r.ketQua === 'loai_tru' && r.lyDoCham == null)
                ? <LyDoChamSelect shipmentId={r.shipmentId} banDau={r.lyDoCham} nguon={r.nguon} sauKhiLuu={sauKhiLuu} />
                : <span className="text-muted-foreground">{r.lyDoCham ? (layLyDo(r.lyDoCham)?.ten ?? r.lyDoCham) : '—'}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </Khung>
  );
}

function BangChungTu({ rows, ky }: { rows: NonNullable<ChiTietKpi['chungTu']>; ky: string }) {
  const tong = rows.reduce((s, r) => s + r.phiSuaDiaChiVnd, 0);
  return (
    <Khung
      tomTat={<><b>{rows.length}</b> kiện phát sinh phí sửa địa chỉ · tổng <b>{vnd(tong)}</b></>}
      onCsv={() => taiCsv(`kpi-${ky}-1.3-don-hoan-hao.csv`,
        ['Thuộc', 'Đơn', 'Tracking', 'Nước', 'Ngày gửi', 'Phí sửa địa chỉ (VND)', 'Tổng bill kiện (VND)'],
        rows.map((r) => [r.thuocVe, r.maDon, r.tracking, r.nuoc, r.ngayGui, r.phiSuaDiaChiVnd, r.tongBillVnd]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Thuộc</th>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Tracking</th>
        <th className={`${TH} text-left`}>Nước</th><th className={`${TH} text-left`}>Ngày gửi</th>
        <th className={`${TH} text-right`}>Phí sửa địa chỉ</th><th className={`${TH} text-right`}>Tổng bill kiện</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Không kiện nào phát sinh phí sửa địa chỉ — tiêu chí này đạt tuyệt đối.</td></tr>}
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left text-muted-foreground">{r.thuocVe}</td>
            <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left font-mono text-[10px]">{r.tracking ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.nuoc ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-right font-semibold text-red-600 dark:text-red-400">{vnd(r.phiSuaDiaChiVnd)}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{vnd(r.tongBillVnd)}</td>
          </tr>
        ))}
      </tbody>
    </Khung>
  );
}

function BangSize({ rows, ky }: { rows: NonNullable<ChiTietKpi['sizeThung']>; ky: string }) {
  const sai = rows.filter((r) => r.phanLoai === 'sai_thung');
  const doiRa = Math.round(sai.reduce((s, r) => s + (r.lechKg ?? 0), 0) * 10) / 10;
  const thieu = rows.filter((r) => r.phanLoai === 'thieu_du_lieu').length;
  const nhan: Record<string, string> = { dung: 'Đúng', sai_thung: 'Sai thùng', nhe_hon: 'Carrier tính nhẹ hơn', thieu_du_lieu: 'Thiếu dữ liệu' };
  const mau: Record<string, string> = {
    dung: 'text-emerald-600 dark:text-emerald-400',
    sai_thung: 'text-red-600 dark:text-red-400',
    nhe_hon: 'text-emerald-600 dark:text-emerald-400',
    thieu_du_lieu: 'text-muted-foreground',
  };
  const [hienHet, setHienHet] = useState(false);
  const hien = hienHet ? rows : rows.filter((r) => laSizeCoVanDe(r.phanLoai));
  // CSV: kiện đúng lên đầu, rồi tới kiện cần soi, trong nhóm xếp theo lệch cân giảm dần.
  const thuTu: Record<string, number> = { dung: 0, nhe_hon: 1, thieu_du_lieu: 2, sai_thung: 3 };
  const choCsv = [...rows].sort((a, b) => thuTu[a.phanLoai] - thuTu[b.phanLoai] || (b.lechKg ?? -Infinity) - (a.lechKg ?? -Infinity));
  return (
    <Khung
      tomTat={<><b>{sai.length}</b> kiện sai thùng trên {rows.length - thieu} kiện chấm được · dôi <b>{doiRa} kg</b> phải trả thêm{thieu > 0 ? ` · ${thieu} kiện thiếu dữ liệu cân` : ''}</>}
      onCsv={() => taiCsv(`kpi-${ky}-1.4-size-thung.csv`,
        ['Đơn', 'Tracking', 'Ngày gửi', 'Cân thực (kg)', 'Cân quy đổi (kg)', 'Cân mình tính (kg)', 'Cân carrier bill (kg)', 'Lệch (kg)', 'Kết quả'],
        choCsv.map((r) => [r.maDon, r.tracking, r.ngayGui, r.canThucKg, r.canQuyDoiKg, r.canTinhCuocKg, r.canBillKg, r.lechKg, nhan[r.phanLoai]]))}
      nut={<NutHienHet hienHet={hienHet} doi={() => setHienHet(!hienHet)} an={rows.length - hien.length} />}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Tracking</th><th className={`${TH} text-left`}>Ngày gửi</th>
        <th className={`${TH} text-right`}>Cân thực</th><th className={`${TH} text-right`}>Quy đổi</th>
        <th className={`${TH} text-right`}>Mình tính</th><th className={`${TH} text-right`}>Carrier bill</th>
        <th className={`${TH} text-right`}>Lệch</th><th className={`${TH} text-left`}>Kết quả</th>
      </tr></thead>
      <tbody>
        {hien.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">{rows.length === 0 ? 'Chưa có kiện nào có hoá đơn trong kỳ.' : 'Không kiện nào sai thùng — mọi kiện đóng đúng size.'}</td></tr>}
        {hien.map((r, i) => (
          <tr key={i} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left font-mono text-[10px]">{r.tracking ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-right">{kg(r.canThucKg)}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{kg(r.canQuyDoiKg)}</td>
            <td className="px-2.5 py-1.5 text-right">{kg(r.canTinhCuocKg)}</td>
            <td className="px-2.5 py-1.5 text-right">{kg(r.canBillKg)}</td>
            <td className={`px-2.5 py-1.5 text-right font-semibold ${(r.lechKg ?? 0) >= 0.5 ? 'text-red-600 dark:text-red-400' : ''}`}>{kg(r.lechKg)}</td>
            <td className={`px-2.5 py-1.5 text-left font-medium ${mau[r.phanLoai]}`}>{nhan[r.phanLoai]}</td>
          </tr>
        ))}
      </tbody>
    </Khung>
  );
}
