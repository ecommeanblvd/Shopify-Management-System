'use client';

import { useState, useTransition } from 'react';
import { csvBody, type CsvValue } from '@/lib/csv';
import { NHAN_KET_QUA_SLA } from '@/features/kpi-logistics/chi-tiet';
import { LOAI_SU_CO, NHAN_THUOC_VE, layLoaiSuCo, tongChiPhi, tomTatSuCo, type KhoanChiPhi, type ThuocVe } from '@/features/ship-ho/su-co';
import type { ChiTietPillar2, LuuSuCoInput } from '@/features/ship-ho/pillar2-actions';

type Tab = 'tien' | 'sla' | 'su-co';
const TABS: Array<{ key: Tab; nhan: string }> = [
  { key: 'tien', nhan: 'Tiền bill vs tiền thu' },
  { key: 'sla', nhan: 'Tiến độ giao vs cam kết' },
  { key: 'su-co', nhan: 'Sự cố & lỗi phạt' },
];
const vnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
const TH = 'sticky top-0 z-10 bg-muted/90 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur';

function taiCsv(ten: string, header: string[], rows: CsvValue[][]) {
  const blob = new Blob(['﻿' + csvBody(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = ten; a.click();
  URL.revokeObjectURL(url);
}

/**
 * Report chi tiết Pillar 2 — ship hộ. Ba mặt của cùng một tập đơn: tiền, tiến độ, sự cố.
 * Nạp lười; chỉ người có quyền quản lý ship hộ mới ghi được sự cố.
 */
export function ChiTietPillar2({ ky, tu, den, tai, luu, xoa, suaDuoc }: {
  ky: string; tu: string; den: string;
  tai: (tu: string, den: string) => Promise<ChiTietPillar2>;
  luu: (input: LuuSuCoInput) => Promise<{ ok: true; id: string }>;
  xoa: (id: string) => Promise<{ ok: true }>;
  suaDuoc: boolean;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [data, setData] = useState<ChiTietPillar2 | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangTai, start] = useTransition();

  const nap = (ep = false) => start(async () => {
    if (data && !ep) return;
    try { setData(await tai(tu, den)); setLoi(null); }
    catch (e) { setLoi(String((e as Error).message ?? e)); }
  });

  const chon = (t: Tab) => {
    if (tab === t) { setTab(null); return; }
    setTab(t);
    nap();
  };

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Report chi tiết Pillar 2 — ship hộ</div>
          <p className="text-[11px] text-muted-foreground">Ngoài sản lượng đơn: tiền carrier bill so với tiền thu brand, tiến độ giao so với cam kết theo nước, và sự cố phải đền.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => chon(t.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${tab === t.key ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border hover:bg-muted'}`}>
              {t.nhan}
            </button>
          ))}
        </div>
      </div>

      {dangTai && <p className="px-4 py-3 text-xs text-muted-foreground animate-pulse">Đang lấy dữ liệu…</p>}
      {loi && <p className="px-4 py-3 text-xs text-red-600 dark:text-red-400">{loi}</p>}
      {!tab && !dangTai && <p className="px-4 py-3 text-xs text-muted-foreground">Chưa chọn mục nào.</p>}

      {tab && data && !dangTai && (
        <div className="space-y-3 p-4">
          {tab === 'tien' && <BangTien rows={data.donHang} ky={ky} />}
          {tab === 'sla' && <BangSlaShipHo rows={data.sla} ky={ky} />}
          {tab === 'su-co' && (
            <BangSuCo rows={data.suCo} donHang={data.donHang} ky={ky} suaDuoc={suaDuoc}
              luu={luu} xoa={xoa} sauKhiLuu={() => nap(true)} />
          )}
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
        <button type="button" onClick={onCsv} className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted">Tải CSV</button>
      </div>
      <div className="max-h-[26rem] overflow-auto rounded-md border border-border">
        <table className="w-full text-xs tabular-nums">{children}</table>
      </div>
    </div>
  );
}

function BangTien({ rows, ky }: { rows: ChiTietPillar2['donHang']; ky: string }) {
  // Đơn chưa báo giá KHÔNG vào phép cộng — cộng vào sẽ ra lỗ ảo đúng bằng tiền cước.
  const coGia = rows.filter((r) => r.thuVnd != null);
  const thu = coGia.reduce((s, r) => s + (r.thuVnd ?? 0), 0);
  const von = coGia.reduce((s, r) => s + r.vonVnd, 0);
  const lo = coGia.filter((r) => (r.laiVnd ?? 0) < 0);
  const tienLo = lo.reduce((s, r) => s + (r.laiVnd ?? 0), 0);
  const chuaCoGia = rows.length - coGia.length;
  const chuaCoBill = rows.filter((r) => !r.vonThat).length;
  return (
    <Khung
      tomTat={<><b>{rows.length}</b> đơn · thu <b>{vnd(thu)}</b> · vốn <b>{vnd(von)}</b> · lãi <b className={thu - von < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>{vnd(thu - von)}</b> · <b>{lo.length}</b> đơn lỗ <b className="text-red-600 dark:text-red-400">{vnd(tienLo)}</b>{chuaCoGia > 0 ? <> · <b className="text-amber-600 dark:text-amber-400">{chuaCoGia}</b> đơn chưa báo giá cho brand, đã loại khỏi phép cộng</> : null}{chuaCoBill > 0 ? ` · ${chuaCoBill} đơn chưa có hoá đơn thật, vốn đang lấy theo báo giá` : ''}</>}
      onCsv={() => taiCsv(`kpi-${ky}-p2-tien.csv`,
        ['Mã đơn', 'Brand', 'Nước', 'Ngày gửi', 'Cân (kg)', 'Thu brand (VND)', 'Vốn carrier (VND)', 'Lãi (VND)', 'Nguồn vốn', 'Trạng thái'],
        rows.map((r) => [r.ma, r.brand, r.nuoc, r.ngayGui, r.canKg, r.thuVnd, r.vonVnd, r.laiVnd, r.vonThat ? 'hoá đơn thật' : 'báo giá', r.trangThai]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Mã đơn</th><th className={`${TH} text-left`}>Brand</th><th className={`${TH} text-left`}>Nước</th>
        <th className={`${TH} text-left`}>Ngày gửi</th><th className={`${TH} text-right`}>Cân</th>
        <th className={`${TH} text-right`}>Thu brand</th><th className={`${TH} text-right`}>Vốn carrier</th>
        <th className={`${TH} text-right`}>Lãi</th><th className={`${TH} text-left`}>Trạng thái</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ nào gửi trong kỳ.</td></tr>}
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left font-medium">{r.ma}</td>
            <td className="px-2.5 py-1.5 text-left">{r.brand}</td>
            <td className="px-2.5 py-1.5 text-left">{r.nuoc}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-right">{r.canKg ?? '—'}</td>
            <td className={`px-2.5 py-1.5 text-right ${r.thuVnd == null ? 'text-amber-600 dark:text-amber-400' : ''}`}>{r.thuVnd == null ? 'chưa báo giá' : vnd(r.thuVnd)}</td>
            <td className={`px-2.5 py-1.5 text-right ${r.vonThat ? '' : 'text-muted-foreground italic'}`}>{vnd(r.vonVnd)}</td>
            <td className={`px-2.5 py-1.5 text-right font-semibold ${r.laiVnd == null ? 'text-muted-foreground' : r.laiVnd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{r.laiVnd == null ? '—' : vnd(r.laiVnd)}</td>
            <td className="px-2.5 py-1.5 text-left text-muted-foreground">{r.trangThai}</td>
          </tr>
        ))}
      </tbody>
    </Khung>
  );
}

function BangSlaShipHo({ rows, ky }: { rows: ChiTietPillar2['sla']; ky: string }) {
  const daGiao = rows.filter((r) => r.ketQua != null);
  const dat = daGiao.filter((r) => r.ketQua === 'dat').length;
  const mau: Record<string, string> = {
    dat: 'text-emerald-600 dark:text-emerald-400',
    tre: 'text-amber-600 dark:text-amber-400',
    ngoai_le: 'text-red-600 dark:text-red-400',
    loai_tru: 'text-muted-foreground',
  };
  return (
    <Khung
      tomTat={<><b>{daGiao.length}</b>/{rows.length} đơn đã có ngày giao · đạt cam kết <b>{dat}</b> ({daGiao.length > 0 ? `${Math.round((dat / daGiao.length) * 1000) / 10}%` : '—'}) · <b>{rows.length - daGiao.length}</b> đơn chưa có ngày giao nên chưa chấm được</>}
      onCsv={() => taiCsv(`kpi-${ky}-p2-sla.csv`,
        ['Mã đơn', 'Brand', 'Nước', 'Ngày gửi', 'Ngày giao', 'Số ngày', 'Cam kết', 'Kết quả', 'Trạng thái giao'],
        rows.map((r) => [r.ma, r.brand, r.nuoc, r.ngayGui, r.ngayGiao, r.soNgay, r.slaNgay, r.ketQua ? NHAN_KET_QUA_SLA[r.ketQua] : 'Chưa giao xong', r.trangThaiGiao]))}
    >
      <thead><tr>
        <th className={`${TH} text-left`}>Mã đơn</th><th className={`${TH} text-left`}>Brand</th><th className={`${TH} text-left`}>Nước</th>
        <th className={`${TH} text-left`}>Gửi</th><th className={`${TH} text-left`}>Giao</th>
        <th className={`${TH} text-right`}>Ngày</th><th className={`${TH} text-right`}>Cam kết</th><th className={`${TH} text-left`}>Kết quả</th>
      </tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Chưa có đơn ship hộ nào gửi trong kỳ.</td></tr>}
        {rows.map((r) => (
          <tr key={r.ma} className="border-t border-border/50">
            <td className="px-2.5 py-1.5 text-left font-medium">{r.ma}</td>
            <td className="px-2.5 py-1.5 text-left">{r.brand}</td>
            <td className="px-2.5 py-1.5 text-left">{r.nuoc}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGui ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-left">{r.ngayGiao ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-right font-semibold">{r.soNgay ?? '—'}</td>
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{r.slaNgay}</td>
            <td className={`px-2.5 py-1.5 text-left font-medium ${r.ketQua ? mau[r.ketQua] : 'text-muted-foreground'}`}>
              {r.ketQua ? NHAN_KET_QUA_SLA[r.ketQua] : `Chưa giao xong${r.trangThaiGiao ? ` · ${r.trangThaiGiao}` : ''}`}
            </td>
          </tr>
        ))}
      </tbody>
    </Khung>
  );
}

function BangSuCo({ rows, donHang, ky, suaDuoc, luu, xoa, sauKhiLuu }: {
  rows: ChiTietPillar2['suCo'];
  donHang: ChiTietPillar2['donHang'];
  ky: string;
  suaDuoc: boolean;
  luu: (input: LuuSuCoInput) => Promise<{ ok: true; id: string }>;
  xoa: (id: string) => Promise<{ ok: true }>;
  sauKhiLuu: () => void;
}) {
  const [mo, setMo] = useState(false);
  const t = tomTatSuCo(rows);
  return (
    <div className="space-y-3">
      <Khung
        tomTat={<><b>{t.n}</b> sự cố · tổng chi phí <b>{vnd(t.tongChiPhiVnd)}</b> · thiệt hại ròng <b className="text-red-600 dark:text-red-400">{vnd(t.thietHaiRongVnd)}</b> · trong đó lỗi nội bộ <b>{t.nNoiBo}</b> vụ <b className="text-red-600 dark:text-red-400">{vnd(t.thietHaiNoiBoVnd)}</b></>}
        onCsv={() => taiCsv(`kpi-${ky}-p2-su-co.csv`,
          ['Ngày', 'Mã đơn', 'Brand', 'Loại sự cố', 'Thuộc về', 'Chi phí (VND)', 'Đã đòi lại (VND)', 'Thiệt hại ròng (VND)', 'Các khoản', 'Mô tả'],
          rows.map((r) => [r.ngay, r.maDon, r.brand, r.tenLoai, NHAN_THUOC_VE[r.thuocVe as ThuocVe] ?? r.thuocVe,
            r.tongChiPhiVnd, r.daThuHoiVnd, r.thietHaiRongVnd,
            r.chiPhi.map((k) => `${k.khoan}: ${k.tienVnd}`).join(' | '), r.moTa]))}
      >
        <thead><tr>
          <th className={`${TH} text-left`}>Ngày</th><th className={`${TH} text-left`}>Đơn</th>
          <th className={`${TH} text-left`}>Loại sự cố</th><th className={`${TH} text-left`}>Thuộc về</th>
          <th className={`${TH} text-right`}>Chi phí</th><th className={`${TH} text-right`}>Đã đòi lại</th>
          <th className={`${TH} text-right`}>Thiệt hại ròng</th><th className={`${TH} text-left`}>Chi tiết</th>
          {suaDuoc && <th className={`${TH} text-right`}></th>}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={suaDuoc ? 9 : 8} className="p-6 text-center text-muted-foreground">Chưa ghi sự cố nào trong kỳ.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/50 align-top">
              <td className="px-2.5 py-1.5 text-left">{r.ngay}</td>
              <td className="px-2.5 py-1.5 text-left font-medium">{r.maDon}<div className="text-[10px] text-muted-foreground">{r.brand}</div></td>
              <td className="px-2.5 py-1.5 text-left">{r.tenLoai}</td>
              <td className={`px-2.5 py-1.5 text-left ${r.thuocVe === 'noi_bo' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}`}>{NHAN_THUOC_VE[r.thuocVe as ThuocVe] ?? r.thuocVe}</td>
              <td className="px-2.5 py-1.5 text-right">{vnd(r.tongChiPhiVnd)}</td>
              <td className="px-2.5 py-1.5 text-right text-emerald-600 dark:text-emerald-400">{r.daThuHoiVnd > 0 ? `−${vnd(r.daThuHoiVnd)}` : '—'}</td>
              <td className="px-2.5 py-1.5 text-right font-semibold text-red-600 dark:text-red-400">{vnd(r.thietHaiRongVnd)}</td>
              <td className="px-2.5 py-1.5 text-left text-muted-foreground">
                {r.chiPhi.map((k, i) => <div key={i}>{k.khoan}: {vnd(k.tienVnd)}</div>)}
                {r.moTa && <div className="italic">{r.moTa}</div>}
              </td>
              {suaDuoc && (
                <td className="px-2.5 py-1.5 text-right">
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-red-600"
                    onClick={async () => { if (confirm(`Xoá sự cố của đơn ${r.maDon}?`)) { await xoa(r.id); sauKhiLuu(); } }}>Xoá</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Khung>

      {suaDuoc && (
        mo
          ? <FormSuCo donHang={donHang} luu={luu} xong={() => { setMo(false); sauKhiLuu(); }} huy={() => setMo(false)} />
          : <button type="button" onClick={() => setMo(true)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">+ Ghi sự cố</button>
      )}
    </div>
  );
}

function FormSuCo({ donHang, luu, xong, huy }: {
  donHang: ChiTietPillar2['donHang'];
  luu: (input: LuuSuCoInput) => Promise<{ ok: true; id: string }>;
  xong: () => void;
  huy: () => void;
}) {
  const [orderId, setOrderId] = useState(donHang[0]?.id ?? '');
  const [loai, setLoai] = useState(LOAI_SU_CO[0].ma);
  const [thuocVe, setThuocVe] = useState<ThuocVe>(LOAI_SU_CO[0].macDinhThuocVe);
  const [ngay, setNgay] = useState(new Date().toISOString().slice(0, 10));
  const [moTa, setMoTa] = useState('');
  const [thuHoi, setThuHoi] = useState('0');
  const [khoan, setKhoan] = useState<KhoanChiPhi[]>([{ khoan: '', tienVnd: 0 }]);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const doiLoai = (ma: string) => {
    setLoai(ma);
    const l = layLoaiSuCo(ma);
    if (l) {
      setThuocVe(l.macDinhThuocVe);
      if (l.khoanGoiY.length) setKhoan(l.khoanGoiY.map((k) => ({ khoan: k, tienVnd: 0 })));
    }
  };
  const o = 'h-8 rounded-md border border-input bg-input/30 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  const tong = tongChiPhi(khoan);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs"><div className="font-medium">Đơn ship hộ</div>
          <select className={`${o} w-full`} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {donHang.map((d) => <option key={d.id} value={d.id}>{d.ma} · {d.brand} · {d.nuoc}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs"><div className="font-medium">Loại sự cố</div>
          <select className={`${o} w-full`} value={loai} onChange={(e) => doiLoai(e.target.value)}>
            {LOAI_SU_CO.map((l) => <option key={l.ma} value={l.ma}>{l.ten}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs"><div className="font-medium">Thuộc về</div>
          <select className={`${o} w-full`} value={thuocVe} onChange={(e) => setThuocVe(e.target.value as ThuocVe)}>
            {(Object.keys(NHAN_THUOC_VE) as ThuocVe[]).map((k) => <option key={k} value={k}>{NHAN_THUOC_VE[k]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs"><div className="font-medium">Ngày xảy ra</div>
          <input type="date" className={`${o} w-full`} value={ngay} onChange={(e) => setNgay(e.target.value)} />
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium">Các khoản tiền</div>
        {khoan.map((k, i) => (
          <div key={i} className="flex gap-2">
            <input className={`${o} flex-1`} placeholder="Tên khoản, ví dụ Cước hoàn hàng về" value={k.khoan}
              onChange={(e) => setKhoan(khoan.map((x, j) => j === i ? { ...x, khoan: e.target.value } : x))} />
            <input type="number" min={0} className={`${o} w-40 text-right`} value={k.tienVnd || ''}
              onChange={(e) => setKhoan(khoan.map((x, j) => j === i ? { ...x, tienVnd: Number(e.target.value) || 0 } : x))} />
            <button type="button" className="px-2 text-xs text-muted-foreground hover:text-red-600"
              onClick={() => setKhoan(khoan.length > 1 ? khoan.filter((_, j) => j !== i) : [{ khoan: '', tienVnd: 0 }])}>×</button>
          </div>
        ))}
        <button type="button" className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setKhoan([...khoan, { khoan: '', tienVnd: 0 }])}>+ thêm khoản</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs"><div className="font-medium">Đã đòi lại được (VND)</div>
          <input type="number" min={0} className={`${o} w-full text-right`} value={thuHoi} onChange={(e) => setThuHoi(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs"><div className="font-medium">Mô tả</div>
          <input className={`${o} w-full`} placeholder="Diễn biến, ai xử lý, kết quả" value={moTa} onChange={(e) => setMoTa(e.target.value)} />
        </label>
      </div>

      {loi && <p className="text-xs text-red-600 dark:text-red-400">{loi}</p>}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">Tổng chi phí <b className="text-foreground">{vnd(tong)}</b> · thiệt hại ròng <b className="text-foreground">{vnd(Math.max(0, tong - (Number(thuHoi) || 0)))}</b></div>
        <div className="flex gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={huy}>Huỷ</button>
          <button type="button" disabled={pending || !orderId || tong <= 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => start(async () => {
              try {
                await luu({ orderId, loai, thuocVe, ngay, moTa: moTa || null, chiPhi: khoan, daThuHoiVnd: Number(thuHoi) || 0 });
                xong();
              } catch (e) { setLoi(String((e as Error).message ?? e)); }
            })}>
            {pending ? 'Đang lưu…' : 'Lưu sự cố'}
          </button>
        </div>
      </div>
    </div>
  );
}
