'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { chotDon, luiVeNhap, danhDauDaGui, huyDon, nhanTraVe, suaGiaVon } from '@/features/kol/actions';
import { chuyenDuoc, suaDongDuoc, ghiGiaVonDuoc } from '@/features/kol/trang-thai';
import { soNgayTre } from '@/features/kol/chi-phi';
import { conNo } from '@/features/kol/tra-ve';
import { ngayKinhDoanh, hienNgayGio } from '@/lib/timezone';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { NHAN_TRANG_THAI, NHAN_MUC_DICH } from './BangDonKol';
import type { DonDayDu } from '@/features/kol/queries';
import type { DongDon } from '@/features/kol/types';

const NHAN_HINH_THUC: Record<'tang' | 'muon', string> = { tang: 'Tặng', muon: 'Mượn' };

/**
 * Ô giá vốn — hiện số nếu có, cho ghi tại chỗ khi `ghiGiaVonDuoc` cho phép.
 * `suaDuoc` tính theo TỪNG DÒNG, không theo cả đơn: đơn đã gửi vẫn mở ô cho
 * dòng còn TRỐNG giá, nhưng khoá chặt dòng đã có số.
 */
function OGiaVon({ d, suaDuoc, onSaved }: { d: DongDon; suaDuoc: boolean; onSaved: () => void }) {
  const [dangSua, setDangSua] = useState(false);
  const [gia, setGia] = useState(d.giaVon ?? '');
  const [tienTe, setTienTe] = useState(d.giaVonTienTe ?? 'VND');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!dangSua) {
    return (
      <div className="space-y-0.5">
        {d.giaVon ? (
          <span className="tabular-nums">{Number(d.giaVon).toLocaleString('vi-VN')} {d.giaVonTienTe}</span>
        ) : (
          <span className="text-xs font-medium text-amber-600">Chưa có giá</span>
        )}
        {suaDuoc && (
          <button type="button" onClick={() => setDangSua(true)}
            className="block cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
            {d.giaVon ? 'Sửa' : 'Nhập giá'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <MoneyInput value={gia} onValueChange={setGia} decimals={tienTe === 'USD' ? 2 : 0} className="w-28" />
        <select className="h-9 rounded-md border border-input bg-background px-1 text-xs" value={tienTe}
          onChange={(e) => setTienTe(e.target.value)}>
          <option value="VND">VND</option>
          <option value="USD">USD</option>
        </select>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <Button type="button" size="xs" disabled={pending} onClick={() => start(async () => {
          setErr(null);
          const fd = new FormData();
          fd.set('dongId', d.id); fd.set('giaVon', gia); fd.set('giaVonTienTe', tienTe);
          const r = await suaGiaVon(fd);
          if (!r.ok) setErr(r.loi ?? 'Lỗi'); else { setDangSua(false); onSaved(); }
        })}>{pending ? 'Đang lưu…' : 'Lưu'}</Button>
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => setDangSua(false)}>Huỷ</Button>
      </div>
    </div>
  );
}

/** Form "Nhận trả về" mở tại chỗ cho một dòng mượn. */
function FormTraVe({ d, onSaved, onClose }: { d: DongDon; onSaved: () => void; onClose: () => void }) {
  const no = conNo(d);
  const [soLuong, setSoLuong] = useState(String(no));
  const [nhapLaiKho, setNhapLaiKho] = useState(true);
  const [lyDo, setLyDo] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Số lượng trả (còn nợ {no})</span>
          <input type="number" min={1} max={no} step={1}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={soLuong} onChange={(e) => setSoLuong(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Xử lý</span>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={nhapLaiKho ? '1' : '0'} onChange={(e) => setNhapLaiKho(e.target.value === '1')}>
            <option value="1">Nhập lại kho</option>
            <option value="0">Không nhập lại</option>
          </select>
        </label>
        {!nhapLaiKho && (
          <label className="text-xs sm:col-span-1">
            <span className="mb-1 block text-muted-foreground">Lý do không nhập lại *</span>
            <input className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="VD hỏng, mất" />
          </label>
        )}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => start(async () => {
          setErr(null);
          const fd = new FormData();
          fd.set('dongId', d.id); fd.set('soLuong', soLuong);
          fd.set('nhapLaiKho', nhapLaiKho ? '1' : '0');
          if (!nhapLaiKho) fd.set('lyDoKhongNhap', lyDo);
          const r = await nhanTraVe(fd);
          if (!r.ok) setErr(r.loi ?? 'Lỗi'); else { onSaved(); onClose(); }
        })}>{pending ? 'Đang lưu…' : 'Xác nhận nhận trả'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onClose}>Đóng</Button>
      </div>
    </div>
  );
}

export function ChiTietDon({ don, dong, canManage }: { don: DonDayDu; dong: DongDon[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [hang, setHang] = useState(don.hangVanChuyen ?? '');
  const [maVanDon, setMaVanDon] = useState(don.maVanDon ?? '');
  const [dongMoTraVe, setDongMoTraVe] = useState<string | null>(null);

  const lam_moi = () => router.refresh();
  const homNay = ngayKinhDoanh(new Date())!;

  const tt = don.trangThai;
  const coTheChot = canManage && chuyenDuoc(tt, 'da_chot');
  const coTheGui = canManage && chuyenDuoc(tt, 'da_gui');
  const coTheLuiVeNhap = canManage && chuyenDuoc(tt, 'nhap');
  const coTheHuy = canManage && chuyenDuoc(tt, 'huy');
  const suaDongDuocO = suaDongDuoc(tt);

  function doChot() {
    start(async () => { setErr(null); const r = await chotDon(don.id); if (!r.ok) setErr(r.loi ?? 'Lỗi'); else lam_moi(); });
  }
  function doLuiVeNhap() {
    start(async () => { setErr(null); const r = await luiVeNhap(don.id); if (!r.ok) setErr(r.loi ?? 'Lỗi'); else lam_moi(); });
  }
  function doHuy() {
    if (!confirm(`Huỷ đơn ${don.ma}? Không thể hoàn tác.`)) return;
    start(async () => { setErr(null); const r = await huyDon(don.id); if (!r.ok) setErr(r.loi ?? 'Lỗi'); else lam_moi(); });
  }
  function doGui() {
    start(async () => {
      setErr(null);
      const fd = new FormData();
      fd.set('donId', don.id); fd.set('hangVanChuyen', hang); fd.set('maVanDon', maVanDon);
      const r = await danhDauDaGui(fd);
      if (!r.ok) setErr(r.loi ?? 'Lỗi'); else lam_moi();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/f/kol" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            ← Đơn KOL &amp; chụp đồ
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{don.ma}</h1>
          <p className="text-sm text-muted-foreground">
            {NHAN_MUC_DICH[don.mucDich]} · {don.quocGia === 'VN' ? 'Nội địa' : 'Quốc tế'} · Tạo lúc {hienNgayGio(don.taoLuc)}
          </p>
        </div>
        <span className="inline-block rounded px-2.5 py-1 text-sm font-medium bg-muted">{NHAN_TRANG_THAI[tt]}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 text-sm">
            <h2 className="mb-1 font-semibold">Người nhận</h2>
            <p>{don.tenNhan}</p>
            {don.dienThoaiNhan && <p className="text-muted-foreground">{don.dienThoaiNhan}</p>}
            <p className="text-muted-foreground">
              {[don.diaChi, don.thanhPho, don.quocGia].filter(Boolean).join(', ')}
            </p>
            {don.ghiChu && <p className="mt-2 text-muted-foreground">Ghi chú: {don.ghiChu}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 text-sm">
            <h2 className="font-semibold">Vận chuyển</h2>
            {coTheGui ? (
              <div className="space-y-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Hãng vận chuyển *</span>
                  <input className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={hang} onChange={(e) => setHang(e.target.value)} placeholder="VD GHN, DHL…" />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">Mã vận đơn *</span>
                  <input className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={maVanDon} onChange={(e) => setMaVanDon(e.target.value)} />
                </label>
                <Button type="button" size="sm" disabled={pending || !hang.trim() || !maVanDon.trim()} onClick={doGui}>
                  {pending ? 'Đang gửi…' : 'Đã gửi'}
                </Button>
              </div>
            ) : (
              <>
                <p>{don.hangVanChuyen ?? '—'} {don.maVanDon ? `· ${don.maVanDon}` : ''}</p>
                <p className="text-muted-foreground">Gửi lúc: {hienNgayGio(don.guiLuc)}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {err && <p className="text-sm font-medium text-red-600">{err}</p>}

      <div className="flex flex-wrap gap-2">
        {coTheChot && <Button type="button" disabled={pending} onClick={doChot}>{pending ? 'Đang chốt…' : 'Chốt đơn'}</Button>}
        {coTheLuiVeNhap && (
          <Button type="button" variant="outline" disabled={pending} onClick={doLuiVeNhap}>
            {pending ? 'Đang lùi…' : 'Lùi về nháp'}
          </Button>
        )}
        {coTheHuy && (
          <Button type="button" variant="destructive" disabled={pending} onClick={doHuy}>
            {pending ? 'Đang huỷ…' : 'Huỷ đơn'}
          </Button>
        )}
        {/* da_gui: hàng đã rời kho — không có nút huỷ, đường về là nhận trả từng dòng mượn. */}
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-semibold">Dòng hàng</h2>
          {suaDongDuocO && (
            <p className="text-xs text-muted-foreground">
              Đơn đang ở trạng thái nháp — chưa hỗ trợ sửa mã hàng/kho/số lượng ở màn này; huỷ đơn và tạo lại nếu cần đổi.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr className="[&>th]:p-2 [&>th]:font-medium">
                  <th>SKU</th><th>Tên hàng</th><th>Kho</th><th className="text-right">SL</th>
                  <th>Hình thức</th><th>Hạn trả</th><th>Giá vốn</th><th>Tình trạng mượn</th><th></th>
                </tr>
              </thead>
              <tbody>
                {dong.map((d) => {
                  const no = conNo(d);
                  const tre = d.hanTra ? soNgayTre(d.hanTra, homNay) : null;
                  return (
                    <Fragment key={d.id}>
                      <tr className="border-b align-top [&>td]:p-2">
                        <td className="font-medium">{d.sku}</td>
                        <td className="text-muted-foreground">{d.tenHang ?? '—'}</td>
                        <td>{d.kho}</td>
                        <td className="text-right tabular-nums">{d.soLuong}</td>
                        <td>{NHAN_HINH_THUC[d.hinhThuc]}</td>
                        <td>{d.hanTra ?? '—'}</td>
                        <td><OGiaVon d={d} suaDuoc={canManage && ghiGiaVonDuoc(tt, d.giaVon)} onSaved={lam_moi} /></td>
                        <td>
                          {d.hinhThuc === 'muon' ? (
                            no > 0 ? (
                              <span className={tre !== null && tre > 0 ? 'font-medium text-red-600' : ''}>
                                Còn nợ {no}{tre !== null && tre > 0 ? ` · trễ ${tre} ngày` : ''}
                              </span>
                            ) : (
                              <span className="text-emerald-600">Đã trả đủ</span>
                            )
                          ) : '—'}
                        </td>
                        <td>
                          {canManage && d.hinhThuc === 'muon' && no > 0 && tt === 'da_gui' && (
                            <button type="button"
                              onClick={() => setDongMoTraVe(dongMoTraVe === d.id ? null : d.id)}
                              className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
                              Nhận trả về
                            </button>
                          )}
                        </td>
                      </tr>
                      {dongMoTraVe === d.id && (
                        <tr>
                          <td colSpan={9} className="px-2 pb-3">
                            <FormTraVe d={d} onSaved={lam_moi} onClose={() => setDongMoTraVe(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
