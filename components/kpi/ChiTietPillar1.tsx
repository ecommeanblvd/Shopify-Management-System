'use client';

import { useState, useTransition } from 'react';
import { csvBody, type CsvValue } from '@/lib/csv';
import {
  TEN_TIEU_CHI, NHAN_KET_QUA_SLA, demKetQuaSla,
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
export function ChiTietPillar1({ tu, den, ky, tai }: {
  tu: string; den: string; ky: string;
  tai: (ma: MaTieuChi, tu: string, den: string) => Promise<ChiTietKpi>;
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

  const data = ma ? kho[ma] : undefined;

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Report chi tiết từng tiêu chí Pillar 1</div>
          <p className="text-[11px] text-muted-foreground">Bấm một tiêu chí để xem đúng những đơn và kiện làm nên con số ở bảng trên.</p>
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
          <p className="text-[11px] leading-relaxed text-muted-foreground">{data.cachDo}</p>
          {data.amCuoc && <BangAmCuoc rows={data.amCuoc} ky={ky} />}
          {data.sla && <BangSla rows={data.sla} ky={ky} />}
          {data.chungTu && <BangChungTu rows={data.chungTu} ky={ky} />}
          {data.sizeThung && <BangSize rows={data.sizeThung} ky={ky} />}
        </div>
      )}
    </section>
  );
}

function Khung({ tomTat, onCsv, children }: { tomTat: React.ReactNode; onCsv: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs">{tomTat}</div>
        <button type="button" onClick={onCsv} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted">
          Tải CSV
        </button>
      </div>
      <div className="max-h-[26rem] overflow-auto rounded-md border border-border">
        <table className="w-full text-xs tabular-nums">{children}</table>
      </div>
    </div>
  );
}

const TH = 'sticky top-0 z-10 bg-muted/90 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur';

function BangAmCuoc({ rows, ky }: { rows: NonNullable<ChiTietKpi['amCuoc']>; ky: string }) {
  const tong = rows.reduce((s, r) => s + r.chenhVnd, 0);
  const daChot = rows.filter((r) => r.phanDinh?.includes('internal_error')).length;
  const chuaXet = rows.filter((r) => !r.phanDinh).length;
  const daThuHoi = rows.reduce((s, r) => s + r.thuHoiVnd, 0);
  return (
    <Khung
      tomTat={<><b>{rows.length}</b> đơn còn âm cước sau khi trừ tiền đã đòi lại · tổng chênh <b>{vnd(tong)}</b> · đã đòi lại được <b>{vnd(daThuHoi)}</b> trên các đơn này · đã chốt lỗi nội bộ <b>{daChot}</b> · chưa ai xét <b>{chuaXet}</b></>}
      onCsv={() => taiCsv(`kpi-${ky}-1.1-am-cuoc.csv`,
        ['Đơn', 'Nước', 'Ngày gửi', 'Khách trả (VND)', 'Carrier bill (VND)', 'Đã đòi lại (VND)', 'Giá vốn ròng (VND)', 'Chênh (VND)', 'Phân định', 'Số credit note'],
        rows.map((r) => [r.maDon, r.nuoc, r.ngayGui, r.thuKhachVnd, r.carrierVnd, r.thuHoiVnd, r.carrierRongVnd, r.chenhVnd, r.phanDinh, r.soCreditNote]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Nước</th><th className={`${TH} text-left`}>Ngày gửi</th>
        <th className={`${TH} text-right`}>Khách trả</th><th className={`${TH} text-right`}>Carrier bill</th>
        <th className={`${TH} text-right`}>Đã đòi lại</th><th className={`${TH} text-right`}>Giá vốn ròng</th>
        <th className={`${TH} text-right`}>Chênh</th><th className={`${TH} text-left`}>Phân định</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Không đơn nào còn âm cước sau giảm trừ.</td></tr>}
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.nuoc ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-right">{vnd(r.thuKhachVnd)}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{vnd(r.carrierVnd)}</td>
            <td className="px-2.5 py-1.5 text-right text-emerald-600 dark:text-emerald-400">{r.thuHoiVnd > 0 ? `−${vnd(r.thuHoiVnd)}` : '—'}</td>
            <td className="px-2.5 py-1.5 text-right">{vnd(r.carrierRongVnd)}</td>
            <td className="px-2.5 py-1.5 text-right font-semibold text-red-600 dark:text-red-400">{vnd(r.chenhVnd)}</td>
            <td className="px-2.5 py-1.5 text-left text-muted-foreground">{r.phanDinh ?? 'chưa phân định'}{r.soCreditNote ? ` · ${r.soCreditNote}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </Khung>
  );
}

function BangSla({ rows, ky }: { rows: NonNullable<ChiTietKpi['sla']>; ky: string }) {
  const d = demKetQuaSla(rows);
  const mau: Record<string, string> = {
    dat: 'text-emerald-600 dark:text-emerald-400',
    tre: 'text-amber-600 dark:text-amber-400',
    ngoai_le: 'text-red-600 dark:text-red-400',
    loai_tru: 'text-muted-foreground',
  };
  return (
    <Khung
      tomTat={<><b>{d.dat}</b> đạt · <b>{d.tre}</b> trễ · <b>{d.ngoai_le}</b> trễ nặng · <b>{d.loai_tru}</b> loại khỏi KPI · tỉ lệ đạt <b>{d.tyLeDat == null ? '—' : `${Math.round(d.tyLeDat * 1000) / 10}%`}</b> trên {d.tinhKpi} kiện. Cột Thước hãng là mức nội bộ chặt hơn của hãng; dấu ⚑ là kiện đạt cam kết với khách nhưng chậm so với thước hãng, không trừ điểm.</>}
      onCsv={() => taiCsv(`kpi-${ky}-1.2-sla.csv`,
        ['Đơn', 'Tracking', 'Nước', 'Hãng', 'Ngày gửi', 'Ngày giao', 'Số ngày', 'Cam kết nước', 'Thước hãng', 'Kết quả', 'Lý do chậm'],
        rows.map((r) => [r.maDon, r.tracking, r.nuoc, r.line, r.ngayGui, r.ngayGiao, r.soNgay, r.slaNgay, r.slaLineNgay, NHAN_KET_QUA_SLA[r.ketQua], r.lyDoCham]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Tracking</th>
        <th className={`${TH} text-left`}>Nước</th><th className={`${TH} text-left`}>Hãng</th>
        <th className={`${TH} text-left`}>Gửi</th><th className={`${TH} text-left`}>Giao</th>
        <th className={`${TH} text-right`}>Ngày</th><th className={`${TH} text-right`}>Cam kết</th><th className={`${TH} text-right`}>Thước hãng</th>
        <th className={`${TH} text-left`}>Kết quả</th><th className={`${TH} text-left`}>Lý do chậm</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">Chưa có kiện nào giao xong trong kỳ.</td></tr>}
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left font-mono text-[10px]">{r.tracking ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.nuoc}</td>
            <td className="px-2.5 py-1.5 text-left uppercase">{r.line}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGiao}</td>
            <td className="px-2.5 py-1.5 text-right font-semibold">{r.soNgay}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{r.slaNgay}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{r.slaLineNgay}{r.slaLineNgay < r.slaNgay && r.soNgay > r.slaLineNgay ? ' ⚑' : ''}</td>
            <td className={`px-2.5 py-1.5 text-left font-medium ${mau[r.ketQua]}`}>{NHAN_KET_QUA_SLA[r.ketQua]}</td>
            <td className="px-2.5 py-1.5 text-left text-muted-foreground">{r.lyDoCham ?? '—'}</td>
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
        ['Đơn', 'Tracking', 'Nước', 'Ngày gửi', 'Phí sửa địa chỉ (VND)', 'Tổng bill kiện (VND)'],
        rows.map((r) => [r.maDon, r.tracking, r.nuoc, r.ngayGui, r.phiSuaDiaChiVnd, r.tongBillVnd]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Tracking</th>
        <th className={`${TH} text-left`}>Nước</th><th className={`${TH} text-left`}>Ngày gửi</th>
        <th className={`${TH} text-right`}>Phí sửa địa chỉ</th><th className={`${TH} text-right`}>Tổng bill kiện</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Không kiện nào phát sinh phí sửa địa chỉ — tiêu chí này đạt tuyệt đối.</td></tr>}
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border/50">
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
  return (
    <Khung
      tomTat={<><b>{sai.length}</b> kiện sai thùng trên {rows.length - thieu} kiện chấm được · dôi <b>{doiRa} kg</b> phải trả thêm{thieu > 0 ? ` · ${thieu} kiện thiếu dữ liệu cân` : ''}</>}
      onCsv={() => taiCsv(`kpi-${ky}-1.4-size-thung.csv`,
        ['Đơn', 'Tracking', 'Ngày gửi', 'Cân thực (kg)', 'Cân quy đổi (kg)', 'Cân mình tính (kg)', 'Cân carrier bill (kg)', 'Lệch (kg)', 'Kết quả'],
        rows.map((r) => [r.maDon, r.tracking, r.ngayGui, r.canThucKg, r.canQuyDoiKg, r.canTinhCuocKg, r.canBillKg, r.lechKg, nhan[r.phanLoai]]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Đơn</th><th className={`${TH} text-left`}>Tracking</th><th className={`${TH} text-left`}>Ngày gửi</th>
        <th className={`${TH} text-right`}>Cân thực</th><th className={`${TH} text-right`}>Quy đổi</th>
        <th className={`${TH} text-right`}>Mình tính</th><th className={`${TH} text-right`}>Carrier bill</th>
        <th className={`${TH} text-right`}>Lệch</th><th className={`${TH} text-left`}>Kết quả</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Chưa có kiện nào có hoá đơn trong kỳ.</td></tr>}
        {rows.map((r, i) => (
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
