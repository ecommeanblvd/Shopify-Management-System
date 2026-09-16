'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  LY_DO_AM_CUOC, NHAN_THUOC_VE_AM_CUOC, canChonSanPham, danhGiaKien, dauHieu, hienCanGram, layLyDoAmCuoc, quyTrachNhiem, thieuSanPham, tongBilledKg,
  type ChiTietGiaiTrinh, type MaLyDoAmCuoc, type SanPhamSaiCan, type ThuocVeAmCuoc,
} from '@/features/kpi-logistics/giai-trinh-am-cuoc';
import { luuGiaiTrinhAmCuoc, xoaGiaiTrinhAmCuoc } from '@/features/kpi-logistics/giai-trinh-actions';
import type { DongAmCuoc, MonTrongDon } from '@/features/kpi-logistics/chi-tiet';

const vnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;
/** Định dạng số ĐÃ LÀ kg. Cân lưu bằng gram thì dùng `hienCanGram`. */
const kg = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100) / 100}kg`);
const o = 'h-8 w-full rounded-md border border-input bg-input/30 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

/** Nhãn trách nhiệm có màu — chỉ 'noi_bo' là đỏ vì chỉ nó bị trừ KPI. */
export function NhanTrachNhiem({ thuocVe }: { thuocVe: string }) {
  const mau = thuocVe === 'noi_bo'
    ? 'bg-red-500/15 text-red-700 dark:text-red-400'
    : thuocVe === 'chua_ro' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${mau}`}>
      {NHAN_THUOC_VE_AM_CUOC[thuocVe as ThuocVeAmCuoc] ?? thuocVe}
    </span>
  );
}

/**
 * Nút + form giải trình một đơn âm cước (CEO 16/09/2026).
 * Số đo lấy sẵn từ hệ thống; người giải trình chọn lý do và điền phần hệ thống không biết.
 * Trách nhiệm KHÔNG chọn tay — tính từ lý do + dữ kiện, hiện trước để biết lưu xong sẽ ra sao.
 */
export function NutGiaiTrinh({ dong, sauKhiLuu }: { dong: DongAmCuoc; sauKhiLuu: () => void }) {
  const [mo, setMo] = useState(false);
  const cu = dong.giaiTrinh;
  const thieu = !!cu && thieuSanPham(cu.lyDo, cu.chiTiet);
  return (
    <>
      <button type="button" onClick={() => setMo(true)}
        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition hover:bg-muted ${cu && !thieu ? 'border-border text-muted-foreground' : 'border-amber-500/50 text-amber-700 dark:text-amber-400'}`}>
        {!cu ? 'Giải trình' : thieu ? 'Chọn món sai' : 'Sửa'}
      </button>
      {mo && <FormGiaiTrinh dong={dong} dong_lai={() => setMo(false)} xong={() => { setMo(false); sauKhiLuu(); }} />}
    </>
  );
}

function FormGiaiTrinh({ dong, dong_lai, xong }: { dong: DongAmCuoc; dong_lai: () => void; xong: () => void }) {
  const cu = dong.giaiTrinh;
  const t = dong.tinHieu;
  const [lyDo, setLyDo] = useState<MaLyDoAmCuoc>((cu?.lyDo as MaLyDoAmCuoc) ?? dong.goiY);
  const [ct, setCt] = useState<ChiTietGiaiTrinh>(() => cu?.chiTiet ?? { soDo: null, lineHnc: false });
  const [ghiChu, setGhiChu] = useState(cu?.ghiChu ?? '');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ld = layLyDoAmCuoc(lyDo)!;
  const trachNhiem = quyTrachNhiem(lyDo, ct);
  const dh = useMemo(() => dauHieu(t), [t]);
  const dat = (patch: Partial<ChiTietGiaiTrinh>) => setCt((c) => ({ ...c, ...patch }));

  // Phụ phí: nếu người nhập chưa điền thì dùng số trên bill cho đúng lý do đang chọn.
  const phiMacDinh = lyDo === 'phi_vung_sau_xa' ? t.phiVungSauXaVnd : lyDo === 'phi_sua_dia_chi' ? t.phiSuaDiaChiVnd : 0;
  const phi = ct.phiVnd ?? (phiMacDinh > 0 ? Math.round(phiMacDinh) : null);

  const luu = () => start(async () => {
    try {
      await luuGiaiTrinhAmCuoc({ orderId: dong.orderId, lyDo, chiTiet: { ...ct, phiVnd: phi }, ghiChu: ghiChu || null });
      xong();
    } catch (e) { setLoi(String((e as Error).message ?? e)); }
  });
  const xoa = () => start(async () => {
    if (!confirm(`Xoá giải trình của đơn ${dong.maDon}? Đơn sẽ về lại "chưa phân định".`)) return;
    try { await xoaGiaiTrinhAmCuoc(dong.orderId); xong(); }
    catch (e) { setLoi(String((e as Error).message ?? e)); }
  });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) dong_lai(); }}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Giải trình {dong.maDon} · âm {vnd(dong.chenhVnd)}</DialogTitle>
          <DialogDescription className="text-xs">
            {dong.nuoc} · gửi {dong.ngayGui} · khách trả {vnd(dong.thuKhachVnd)} · hãng bill {vnd(dong.carrierRongVnd)}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-1.5 rounded-md border border-border p-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Hệ thống đo được</div>
          {t.kien.length === 0 && <p className="text-xs text-muted-foreground">Chưa có số đo kiện trong kỳ.</p>}
          <table className="w-full text-xs tabular-nums">
            {t.kien.length > 0 && (
              <thead className="text-[10px] text-muted-foreground">
                <tr className="[&>th]:py-0.5 [&>th]:font-medium">
                  <th className="text-left">Kiện</th><th className="text-right">Cân thực</th><th className="text-right">Thùng (cm)</th>
                  <th className="text-right">Quy đổi</th><th className="text-right">Hãng tính</th><th className="text-right">Lệch</th>
                </tr>
              </thead>
            )}
            <tbody>
              {t.kien.map((k, i) => {
                const d = danhGiaKien(k);
                return (
                  <tr key={i} className="[&>td]:py-0.5">
                    <td className="text-left">#{i + 1}</td>
                    <td className="text-right">{kg(d.thucKg)}</td>
                    <td className="text-right text-muted-foreground">{k.daiCm && k.rongCm && k.caoCm ? `${k.daiCm}×${k.rongCm}×${k.caoCm}` : '—'}</td>
                    <td className="text-right">{kg(d.quyDoiKg || null)}</td>
                    <td className="text-right font-medium">{kg(d.billedKg)}</td>
                    <td className={`text-right ${(d.lechKg ?? 0) >= 0.5 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                      {d.lechKg == null ? '—' : `${d.lechKg > 0 ? '+' : ''}${d.lechKg}kg`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {dh.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {dh.map((x) => <span key={x} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{x}</span>)}
            </div>
          )}
          <p className="text-xs tabular-nums">
            Cân khai trên web (checkout báo cước theo số này): <b>{kg(t.canWebKg ?? null)}</b>
            {' '}· hãng tính tổng <b>{kg(tongBilledKg(t))}</b>
          </p>
          <p className="text-[10px] text-muted-foreground">
            Lệch = hãng tính − max(cân thực, cân quy đổi). Lệch từ 0,5kg trở lên nghĩa là hãng tính nặng hơn kiện thật.
            Hãng tính đúng mà vẫn cao hơn cân web thì lỗi nằm ở cân sản phẩm trên web.
          </p>
        </section>

        {/* Ô chọn thả xuống thay cho 8 nút tròn: chọn xong thì phần cần điền hiện ngay bên dưới,
            không phải cuộn qua cả danh sách lý do (CEO 16/09/2026). */}
        <label className="block space-y-1 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            Nguyên nhân
            {lyDo === dong.goiY && <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] font-normal text-emerald-700 dark:text-emerald-400">hệ thống gợi ý</span>}
          </span>
          <select className={`${o} h-9 text-sm`} value={lyDo} onChange={(e) => setLyDo(e.target.value as MaLyDoAmCuoc)}>
            {LY_DO_AM_CUOC.map((l) => (
              <option key={l.ma} value={l.ma}>{l.ten}{l.ma === dong.goiY ? ' — hệ thống gợi ý' : ''}</option>
            ))}
          </select>
          <span className="block text-[11px] text-muted-foreground">→ {ld.huongXuLy}</span>
        </label>

        {ld.truong.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {ld.truong.includes('sanPhamSai') && (
              <ChonMonSaiCan mon={dong.monHang} chon={ct.sanPhamSai ?? []} doi={(x) => dat({ sanPhamSai: x })} />
            )}
            {ld.truong.includes('phiVnd') && (
              <label className="space-y-1 text-xs"><div className="font-medium">Số tiền phụ phí (VND)</div>
                <input type="number" min={0} className={`${o} text-right`} value={phi ?? ''}
                  onChange={(e) => dat({ phiVnd: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            )}
            {ld.truong.includes('soTienDoiVnd') && (
              <label className="space-y-1 text-xs"><div className="font-medium">Số tiền đòi hãng (VND)</div>
                <input type="number" min={0} className={`${o} text-right`} value={ct.soTienDoiVnd ?? ''}
                  onChange={(e) => dat({ soTienDoiVnd: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            )}
            {ld.truong.includes('nguonSaiDiaChi') && (
              <label className="space-y-1 text-xs"><div className="font-medium">Ai cung cấp sai địa chỉ?</div>
                <select className={o} value={ct.nguonSaiDiaChi ?? 'chua_ro'}
                  onChange={(e) => dat({ nguonSaiDiaChi: e.target.value as ChiTietGiaiTrinh['nguonSaiDiaChi'] })}>
                  <option value="chua_ro">Chưa xác định</option>
                  <option value="khach">Khách nhập sai</option>
                  <option value="noi_bo">Mình nhập sai khi tạo vận đơn</option>
                </select>
              </label>
            )}
            {ld.truong.includes('lyDoTach') && (
              <label className="space-y-1 text-xs"><div className="font-medium">Vì sao phải tách kiện?</div>
                <select className={o} value={ct.lyDoTach ?? 'chua_ro'}
                  onChange={(e) => dat({ lyDoTach: e.target.value as ChiTietGiaiTrinh['lyDoTach'] })}>
                  <option value="chua_ro">Chưa xác định</option>
                  <option value="thieu_hang">Kho thiếu hàng, giao phần còn lại sau</option>
                  <option value="khach_yeu_cau">Khách yêu cầu</option>
                  <option value="do_kich_thuoc">Đồ quá khổ, không đóng chung được</option>
                </select>
              </label>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="size-3.5 accent-primary" checked={ct.lineHnc === true} onChange={(e) => dat({ lineHnc: e.target.checked })} />
            Đơn đi line HNC
          </label>
          <label className="block space-y-1 text-xs">
            <div className="font-medium">Ghi chú {lyDo === 'khac' ? '(bắt buộc)' : '(không bắt buộc)'}</div>
            <textarea rows={2} className={`${o} h-auto py-1.5`} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} />
          </label>
        </div>

        {loi && <p className="text-xs text-red-600 dark:text-red-400">{loi}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="text-xs">Trách nhiệm sau khi lưu: <NhanTrachNhiem thuocVe={trachNhiem} /></div>
          <div className="flex gap-2">
            {cu && <button type="button" onClick={xoa} disabled={pending} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-red-600 disabled:opacity-50">Xoá giải trình</button>}
            <button type="button" onClick={dong_lai} disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Huỷ</button>
            <button type="button" onClick={luu} disabled={pending || (lyDo === 'khac' && !ghiChu.trim()) || (canChonSanPham(lyDo) && !ct.sanPhamSai?.length)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              {pending ? 'Đang lưu…' : 'Lưu giải trình'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Chọn đúng món khai sai cân và nhập cân đúng (CEO 16/09/2026: "không thể tù mù được").
 * Tick một món thì ô cân điền sẵn cân hệ thống gợi ý — sửa lại nếu biết con số chính xác hơn.
 * Đơn một món thì tick sẵn luôn, không bắt bấm thêm.
 */
function ChonMonSaiCan({ mon, chon, doi }: {
  mon: MonTrongDon[]; chon: SanPhamSaiCan[]; doi: (x: SanPhamSaiCan[]) => void;
}) {
  const theoSku = new Map(chon.map((c) => [c.sku, c]));
  const [nhap, setNhap] = useState<Record<string, string>>(
    () => Object.fromEntries(chon.map((c) => [c.sku, String(c.canMoiG / 1000)])),
  );
  // Đơn một món: chọn sẵn với cân gợi ý — chỉ một lần khi mở, người nhập bỏ tick được.
  const daTuChon = useRef(false);
  useEffect(() => {
    if (daTuChon.current) return;
    daTuChon.current = true;
    const m = mon[0];
    if (mon.length === 1 && chon.length === 0 && m.goiYG) {
      doi([{ sku: m.sku, canMoiG: m.goiYG }]);
      setNhap({ [m.sku]: String(m.goiYG / 1000) });
    }
  }, [mon, chon, doi]);

  const tick = (m: MonTrongDon) => {
    if (theoSku.has(m.sku)) { doi(chon.filter((c) => c.sku !== m.sku)); return; }
    const g = m.goiYG ?? m.canHienTaiG ?? 0;
    setNhap((n) => ({ ...n, [m.sku]: g ? String(g / 1000) : '' }));
    doi([...chon, { sku: m.sku, canMoiG: g }]);
  };
  const doiCan = (sku: string, v: string) => {
    setNhap((n) => ({ ...n, [sku]: v }));
    const kgSo = Number(v.replace(',', '.'));
    doi(chon.map((c) => (c.sku === sku ? { ...c, canMoiG: Number.isFinite(kgSo) ? Math.round(kgSo * 1000) : 0 } : c)));
  };

  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="text-xs font-medium">Món nào khai sai cân? Tick món sai và nhập cân đúng (kg)</div>
      {mon.length === 0 && <p className="text-xs text-red-600 dark:text-red-400">Đơn không có dòng hàng mang SKU — không chọn được món.</p>}
      <div className="divide-y divide-border rounded-md border border-border">
        {mon.map((m) => {
          const dc = theoSku.get(m.sku);
          const thap = dc && m.canHienTaiG != null && dc.canMoiG <= m.canHienTaiG;
          return (
            <div key={m.sku} className={`flex flex-wrap items-center gap-2 px-2.5 py-2 text-xs ${dc ? 'bg-muted/40' : ''}`}>
              <input type="checkbox" className="size-3.5 accent-primary" checked={!!dc} onChange={() => tick(m)}
                aria-label={`Chọn ${m.sku}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{m.tenSanPham}{m.bienThe ? ` · ${m.bienThe}` : ''}{m.soLuong > 1 ? ` × ${m.soLuong}` : ''}</span>
                <span className="block font-mono text-[10px] text-muted-foreground">{m.sku}</span>
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                đang khai <b className="text-foreground">{hienCanGram(m.canHienTaiG)}</b>
                {m.goiYG != null && <span className="block text-[10px]">gợi ý {hienCanGram(m.goiYG)}</span>}
              </span>
              {dc && (
                <label className="flex items-center gap-1">
                  <span className="text-muted-foreground">cân đúng</span>
                  <input inputMode="decimal" className={`${o} w-20 text-right ${thap ? 'border-red-500' : ''}`}
                    value={nhap[m.sku] ?? ''} onChange={(e) => doiCan(m.sku, e.target.value)} aria-label={`Cân đúng của ${m.sku}`} />
                  <span className="text-muted-foreground">kg</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {chon.some((c) => { const m = mon.find((x) => x.sku === c.sku); return m?.canHienTaiG != null && c.canMoiG <= m.canHienTaiG; }) && (
        <p className="text-[11px] text-red-600 dark:text-red-400">Cân đúng phải cao hơn cân đang khai — nếu không thì món đó không phải món sai.</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Cân đúng = cân khi đã đóng gói, vì hãng tính theo thùng. Số này sẽ lên trang Sửa cân sản phẩm để quản lý duyệt.
      </p>
    </div>
  );
}
