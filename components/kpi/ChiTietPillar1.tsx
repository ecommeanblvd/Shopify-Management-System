'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { csvBody, type CsvValue } from '@/lib/csv';
import { LyDoChamSelect } from '@/components/shipments/LyDoChamSelect';
import { NutGiaiTrinh, NhanTrachNhiem } from './GiaiTrinhAmCuoc';
import { dauHieu, layLyDoAmCuoc, thieuSanPham, NHAN_THUOC_VE_AM_CUOC } from '@/features/kpi-logistics/giai-trinh-am-cuoc';
import { layLyDo, loaiTruKhoiKpi, duyetTayDuoc } from '@/features/shipments/ly-do-cham';
import { NutDuyetLyDo } from '@/components/shipments/NutDuyetLyDo';
import { DaiNop12 } from './DaiNop12';
import { NutTraLaiDong } from './NutTraLaiDong';
import { dongBiKhoa, traLaiDuoc, type TrangThaiNop } from '@/features/kpi-logistics/nop-1-2';
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
export function ChiTietPillar1({ tu, den, ky, tai, ganLyDoDuoc, duyetDuoc = false, nop12 }: {
  tu: string; den: string; ky: string;
  tai: (ma: MaTieuChi, tu: string, den: string) => Promise<ChiTietKpi>;
  /** Nhân sự có quyền đối soát phí ship mới gán được lý do chậm ngay trên bảng. */
  ganLyDoDuoc: boolean;
  /** Chỉ quản lý mới duyệt tay được kiện mà hệ thống không kiểm được. */
  duyetDuoc?: boolean;
  /** Trạng thái nộp của tiêu chí 1.2 trong kỳ; bỏ trống = coi như đang làm. */
  nop12?: { trangThai: TrangThaiNop; nopAt: string | null; duyetAt: string | null; soDongDangTraLai: number };
}) {
  /* MỞ SẴN 1.1 thay vì để trống (CEO 30/09/2026). Tiêu chí 1.1 là thứ có việc phải làm nhiều
   * nhất — giải trình từng đơn âm cước — nên để trống là bắt người dùng bấm thêm một nhịp ở
   * đúng chỗ họ luôn phải vào. */
  const MAC_DINH: MaTieuChi = '1.1';
  const [ma, setMa] = useState<MaTieuChi | null>(MAC_DINH);
  /* Kho nhớ GẮN VỚI KỲ. Trước nay chỉ nhớ theo mã tiêu chí, mà đổi kỳ thì component không bị
   * dựng lại (điều hướng client giữ nguyên vị trí trong cây React) — nên dữ liệu kỳ cũ nằm lại
   * dưới nhãn kỳ mới. Suy ra từ khoá kỳ thay vì xoá bằng setState trong effect. */
  const khoaKy = `${tu}|${den}`;
  const [kho, setKho] = useState<{ ky: string; data: Partial<Record<MaTieuChi, ChiTietKpi>> }>({ ky: khoaKy, data: {} });
  const duLieuKy = kho.ky === khoaKy ? kho.data : {};
  const [loi, setLoi] = useState<string | null>(null);
  const [dangTai, start] = useTransition();

  const ghiKho = (m: MaTieuChi, d: ChiTietKpi) =>
    setKho((cu) => ({ ky: khoaKy, data: { ...(cu.ky === khoaKy ? cu.data : {}), [m]: d } }));

  /** Tiêu chí + kỳ nào ĐÃ yêu cầu rồi — chặn effect gọi lại vòng vô hạn. */
  const daYeuCau = useRef<Set<string>>(new Set());

  // Nạp tiêu chí đang chọn: chạy cả lúc mới mở (1.1) lẫn khi đổi kỳ.
  useEffect(() => {
    if (ma == null) return;
    const khoa = `${khoaKy}|${ma}`;
    if (daYeuCau.current.has(khoa)) return;
    daYeuCau.current.add(khoa);
    start(async () => {
      try {
        const d = await tai(ma, tu, den);
        setKho((cu) => ({ ky: khoaKy, data: { ...(cu.ky === khoaKy ? cu.data : {}), [ma]: d } }));
      } catch (e) {
        setLoi(String((e as Error).message ?? e));
      }
    });
  }, [ma, khoaKy, tai, tu, den]);

  const chon = (m: MaTieuChi) => {
    setLoi(null);
    setMa(ma === m ? null : m);
  };

  /** Nạp lại một tiêu chí sau khi đổi dữ liệu (gán lý do chậm có thể đổi cả kết quả chấm). */
  const taiLai = (m: MaTieuChi) => start(async () => {
    try {
      ghiKho(m, await tai(m, tu, den));
    } catch (e) {
      setLoi(String((e as Error).message ?? e));
    }
  });

  const data = ma ? duLieuKy[ma] : undefined;

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
      {!ma && !dangTai && <p className="px-4 py-3 text-xs text-muted-foreground">Đã đóng — bấm một tiêu chí để mở lại.</p>}

      {ma && data && !dangTai && (
        <div className="space-y-3 p-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{data.cachDo} {PHAM_VI_THEO_MA[ma]}</p>
          {data.amCuoc && <BangAmCuoc rows={data.amCuoc} ky={ky} giaiTrinhDuoc={ganLyDoDuoc} sauKhiLuu={() => taiLai('1.1')} />}
          {data.sla && <BangSla rows={data.sla} ky={ky} ganLyDoDuoc={ganLyDoDuoc} duyetDuoc={duyetDuoc} nop12={nop12} sauKhiLuu={() => taiLai('1.2')} />}
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

const NHAN_DOI_CHIEU: Record<string, string> = {
  xac_nhan: 'Hãng xác nhận', khong_thay: 'Hãng không có dấu hiệu', khong_kiem_duoc: 'Không kiểm được',
};

/** Kết quả đối chiếu lý do với hãng (FedEx / UPS) — nói rõ kiện có được rút khỏi mẫu số không và vì sao. */
function NhanDoiChieu({ ketQua, bangChung, duyet }: { ketQua: string | null; bangChung: string | null; duyet?: string | null }) {
  const [mau, chu] = ketQua === 'xac_nhan' ? ['text-emerald-600 dark:text-emerald-400', '✓ Hãng xác nhận — rời mẫu số']
    : ketQua === 'khong_thay' ? ['text-red-600 dark:text-red-400', '✗ Hãng không có dấu hiệu — vẫn tính trễ']
    // Máy mù mà đã có người duyệt thì nói theo người: nhãn "vẫn tính trễ" ở đây sẽ mâu thuẫn
    // với chính con số trên đầu bảng, và người đọc sẽ tin cái nào cũng sai.
    : ketQua === 'khong_kiem_duoc' ? (duyet === 'duyet'
        ? ['text-muted-foreground', '— Máy không kiểm được, quản lý đã duyệt']
        : ['text-muted-foreground', '— Không kiểm được — vẫn tính trễ'])
    : ['text-muted-foreground', '⋯ Đang đối chiếu với hãng'];
  return (
    <span className={`mt-0.5 block text-[10px] ${mau}`} title={bangChung ?? undefined}>
      {chu}{bangChung && <span className="block text-muted-foreground">{bangChung}</span>}
    </span>
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

function BangSla({ rows, ky, ganLyDoDuoc, duyetDuoc, nop12, sauKhiLuu }: {
  rows: NonNullable<ChiTietKpi['sla']>; ky: string; ganLyDoDuoc: boolean; duyetDuoc: boolean;
  nop12?: { trangThai: TrangThaiNop; nopAt: string | null; duyetAt: string | null; soDongDangTraLai: number };
  sauKhiLuu: () => void;
}) {
  const tt: TrangThaiNop = nop12?.trangThai ?? 'dang_lam';
  const d = demKetQuaSla(rows);
  const coLyDoLoaiTru = rows.filter((r) => r.lyDoCham && loaiTruKhoiKpi(r.lyDoCham));
  const dc = {
    xacNhan: coLyDoLoaiTru.filter((r) => r.lyDoDoiChieu === 'xac_nhan').length,
    khongThay: coLyDoLoaiTru.filter((r) => r.lyDoDoiChieu === 'khong_thay').length,
    khongKiem: coLyDoLoaiTru.filter((r) => r.lyDoDoiChieu === 'khong_kiem_duoc').length,
    cho: coLyDoLoaiTru.filter((r) => !r.lyDoDoiChieu).length,
  };
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
    <>
    {nop12 && <DaiNop12 ky={ky} trangThai={tt} nopAt={nop12.nopAt} duyetAt={nop12.duyetAt}
      soDongDangTraLai={nop12.soDongDangTraLai} ganLyDoDuoc={ganLyDoDuoc} laQuanLy={duyetDuoc} sauKhiLuu={sauKhiLuu} />}
    <Khung
      tomTat={<><b>{d.dat}</b> đạt · <b>{d.tre}</b> trễ · <b>{d.ngoai_le}</b> trễ nặng · <b>{d.loai_tru}</b> loại khỏi KPI · <b>{d.chua_den_han}</b> chưa tới hạn (chưa giao, còn trong cam kết — đứng ngoài mẫu số) · tỉ lệ đạt <b>{d.tyLeDat == null ? '—' : `${Math.round(d.tyLeDat * 1000) / 10}%`}</b> trên {d.tinhKpi} kiện. Cột Thước hãng là mức nội bộ chặt hơn của hãng; dấu ⚑ là kiện đạt cam kết với khách nhưng chậm so với thước hãng, không trừ điểm.{ganLyDoDuoc ? ' Chọn lý do chậm ngay ở cột cuối.' : ''} Lý do ngoài tầm kiểm soát chỉ rút kiện khỏi mẫu số khi hãng (FedEx / UPS) có sự kiện xác nhận.{coLyDoLoaiTru.length > 0 && <> Đối chiếu: <b className="text-emerald-600 dark:text-emerald-400">{dc.xacNhan}</b> xác nhận · <b className="text-red-600 dark:text-red-400">{dc.khongThay}</b> hãng không có dấu hiệu · <b>{dc.khongKiem}</b> không kiểm được{dc.cho > 0 && <> · <b>{dc.cho}</b> đang chờ</>}.</>}</>}
      onCsv={() => taiCsv(`kpi-${ky}-1.2-sla.csv`,
        ['Thuộc', 'Đơn', 'Tracking', 'Nước', 'Hãng', 'Ngày gửi', 'Ngày giao', 'Số ngày', 'Cam kết nước', 'Thước hãng', 'Kết quả', 'Lý do chậm', 'Đối chiếu hãng', 'Bằng chứng'],
        xepChoCsv(rows).map((r) => [r.thuocVe, r.maDon, r.tracking, r.nuoc, r.line, r.ngayGui, r.ngayGiao, r.soNgay, r.slaNgay, r.slaLineNgay, NHAN_KET_QUA_SLA[r.ketQua], r.lyDoCham ? (layLyDo(r.lyDoCham)?.ten ?? r.lyDoCham) : null,
          r.lyDoDoiChieu ? NHAN_DOI_CHIEU[r.lyDoDoiChieu] ?? r.lyDoDoiChieu : (r.lyDoCham && loaiTruKhoiKpi(r.lyDoCham) ? 'Đang chờ' : null), r.lyDoBangChung ?? null]))}
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
              {/* Kỳ đã gửi đi duyệt thì ô chọn KHOÁ, trừ dòng quản lý đã trả lại — trả lại chính
                  là mở khoá đúng chỗ cần sửa. Máy chủ chặn lần nữa, ẩn ô không phải là khoá. */}
              {ganLyDoDuoc && r.shipmentId
                && !dongBiKhoa(tt, r.lyDoTraLai != null)
                && r.ketQua !== 'dat' && r.ketQua !== 'chua_den_han'
                && !(r.ketQua === 'loai_tru' && r.lyDoCham == null)
                ? <LyDoChamSelect shipmentId={r.shipmentId} banDau={r.lyDoCham} nguon={r.nguon} sauKhiLuu={sauKhiLuu} />
                : <span className="text-muted-foreground">
                    {r.lyDoCham ? (layLyDo(r.lyDoCham)?.ten ?? r.lyDoCham) : '—'}
                    {dongBiKhoa(tt, r.lyDoTraLai != null) && r.lyDoCham && <span className="ml-1 text-[10px]">🔒</span>}
                  </span>}
              {r.lyDoCham && loaiTruKhoiKpi(r.lyDoCham) && <NhanDoiChieu ketQua={r.lyDoDoiChieu ?? null} bangChung={r.lyDoBangChung ?? null} duyet={r.lyDoDuyet ?? null} />}
              {/* Nút duyệt CHỈ hiện đúng chỗ máy mù — `duyetTayDuoc` là cùng một luật máy chủ
                  dùng để chặn, nên giao diện không bao giờ mời bấm một việc sẽ bị từ chối. */}
              {duyetDuoc && r.shipmentId && duyetTayDuoc(r.lyDoCham, r.lyDoDoiChieu)
                && <NutDuyetLyDo shipmentId={r.shipmentId} nguon={r.nguon} daDuyet={r.lyDoDuyet ?? null} sauKhiLuu={sauKhiLuu} />}
              {r.shipmentId && r.lyDoCham && (r.lyDoTraLai != null || (duyetDuoc && traLaiDuoc(tt)))
                && <NutTraLaiDong ky={ky} nguon={r.nguon} id={r.shipmentId} daTraLai={r.lyDoTraLai ?? null} sauKhiLuu={sauKhiLuu} />}
            </td>
          </tr>
        ))}
      </tbody>
    </Khung>
    </>
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
  // Kiện chính hãng đã xuất chứng từ điều chỉnh: vẫn hiện để Ops thấy hãng hay ghi
  // sai ở đâu, nhưng KHÔNG chấm kho và KHÔNG cộng vào kg dôi (CEO 28/09/2026).
  const daSua = rows.filter((r) => r.phanLoai === 'da_dieu_chinh');
  const kgDaSua = Math.round(daSua.reduce((s, r) => s + (r.lechKg ?? 0), 0) * 10) / 10;
  const nhan: Record<string, string> = { dung: 'Đúng', sai_thung: 'Sai thùng', nhe_hon: 'Carrier tính nhẹ hơn', thieu_du_lieu: 'Thiếu dữ liệu', da_dieu_chinh: 'Hãng đã điều chỉnh' };
  const mau: Record<string, string> = {
    dung: 'text-emerald-600 dark:text-emerald-400',
    sai_thung: 'text-red-600 dark:text-red-400',
    nhe_hon: 'text-emerald-600 dark:text-emerald-400',
    thieu_du_lieu: 'text-muted-foreground',
    da_dieu_chinh: 'text-amber-700 dark:text-amber-400',
  };
  const [hienHet, setHienHet] = useState(false);
  const hien = hienHet ? rows : rows.filter((r) => laSizeCoVanDe(r.phanLoai));
  // CSV: kiện đúng lên đầu, rồi tới kiện cần soi, trong nhóm xếp theo lệch cân giảm dần.
  const thuTu: Record<string, number> = { dung: 0, nhe_hon: 1, thieu_du_lieu: 2, da_dieu_chinh: 3, sai_thung: 4 };
  const choCsv = [...rows].sort((a, b) => thuTu[a.phanLoai] - thuTu[b.phanLoai] || (b.lechKg ?? -Infinity) - (a.lechKg ?? -Infinity));
  return (
    <Khung
      tomTat={<><b>{sai.length}</b> kiện sai thùng trên {rows.length - thieu - daSua.length} kiện chấm được · dôi <b>{doiRa} kg</b> phải trả thêm{daSua.length > 0 ? ` · ${daSua.length} kiện hãng đã điều chỉnh (${kgDaSua} kg, không tính cho kho)` : ''}{thieu > 0 ? ` · ${thieu} kiện thiếu dữ liệu cân` : ''}</>}
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
