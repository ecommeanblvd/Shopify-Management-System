'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { taoNguoiNhan, suaNguoiNhan, doiNgungDung } from '@/features/kol/actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NHAN_MUC_DICH } from './BangDonKol';
import type { NguoiNhan, DonTomTat, MonDangGiu } from '@/features/kol/queries';

const inputCls = 'block w-full h-9 rounded-md border border-input bg-background px-2 text-sm';

interface HoSoTho {
  ten: string; kenh: string; dienThoai: string; email: string;
  quocGia: string; thanhPho: string; diaChi: string; ghiChu: string;
}

const hoSoRong: HoSoTho = { ten: '', kenh: '', dienThoai: '', email: '', quocGia: 'VN', thanhPho: '', diaChi: '', ghiChu: '' };

function hoSoTuNguoiNhan(n: NguoiNhan): HoSoTho {
  return {
    ten: n.ten, kenh: n.kenh ?? '', dienThoai: n.dienThoai ?? '', email: n.email ?? '',
    quocGia: n.quocGia, thanhPho: n.thanhPho ?? '', diaChi: n.diaChi ?? '', ghiChu: n.ghiChu ?? '',
  };
}

/** Khối các ô nhập dùng chung cho form Thêm và form Sửa (Sửa chỉ hiện, chưa gửi được — xem `FormSua`). */
function CacO({ v, set }: { v: HoSoTho; set: (patch: Partial<HoSoTho>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-xs sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Tên *</span>
        <input className={inputCls} value={v.ten} onChange={(e) => set({ ten: e.target.value })} />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Kênh</span>
        <input className={inputCls} value={v.kenh} onChange={(e) => set({ kenh: e.target.value })} placeholder="VD TikTok, Instagram…" />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Điện thoại</span>
        <input className={inputCls} value={v.dienThoai} onChange={(e) => set({ dienThoai: e.target.value })} />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Email</span>
        <input className={inputCls} value={v.email} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Quốc gia</span>
        <input className={inputCls} value={v.quocGia} onChange={(e) => set({ quocGia: e.target.value })} />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Thành phố</span>
        <input className={inputCls} value={v.thanhPho} onChange={(e) => set({ thanhPho: e.target.value })} />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Địa chỉ</span>
        <input className={inputCls} value={v.diaChi} onChange={(e) => set({ diaChi: e.target.value })} />
      </label>
      <label className="text-xs sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Ghi chú</span>
        <textarea className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" rows={2}
          value={v.ghiChu} onChange={(e) => set({ ghiChu: e.target.value })} />
      </label>
    </div>
  );
}

/** Form "Thêm hồ sơ" — gọi thẳng `taoNguoiNhan` (đã có sẵn ở actions.ts), hoạt động đầy đủ. */
function FormThem({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<HoSoTho>(hoSoRong);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<HoSoTho>) => setV((prev) => ({ ...prev, ...patch }));

  const submit = () =>
    start(async () => {
      setErr(null);
      if (!v.ten.trim()) { setErr('Tên là bắt buộc.'); return; }
      const fd = new FormData();
      fd.set('ten', v.ten); fd.set('kenh', v.kenh); fd.set('dienThoai', v.dienThoai);
      fd.set('email', v.email); fd.set('quocGia', v.quocGia); fd.set('thanhPho', v.thanhPho);
      fd.set('diaChi', v.diaChi); fd.set('ghiChu', v.ghiChu);
      const r = await taoNguoiNhan(fd);
      if (!r.ok) { setErr(r.loi ?? 'Có lỗi xảy ra.'); return; }
      onClose();
      router.push(`/f/kol/nguoi-nhan?id=${r.id}`);
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-3">
        <h2 className="text-sm font-semibold">Thêm hồ sơ mới</h2>
        <CacO v={v} set={set} />
        {err && <p className="text-xs font-medium text-red-600">{err}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={submit}>
            {pending ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onClose}>Huỷ</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Form "Sửa hồ sơ" — gọi `suaNguoiNhan` (Fix round 1: action đã có, mở khoá form). */
function FormSua({ hoSo, onSaved, onClose }: { hoSo: NguoiNhan; onSaved: () => void; onClose: () => void }) {
  const [v, setV] = useState<HoSoTho>(hoSoTuNguoiNhan(hoSo));
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<HoSoTho>) => setV((prev) => ({ ...prev, ...patch }));

  const submit = () =>
    start(async () => {
      setErr(null);
      if (!v.ten.trim()) { setErr('Tên là bắt buộc.'); return; }
      const fd = new FormData();
      fd.set('id', hoSo.id);
      fd.set('ten', v.ten); fd.set('kenh', v.kenh); fd.set('dienThoai', v.dienThoai);
      fd.set('email', v.email); fd.set('quocGia', v.quocGia); fd.set('thanhPho', v.thanhPho);
      fd.set('diaChi', v.diaChi); fd.set('ghiChu', v.ghiChu);
      const r = await suaNguoiNhan(fd);
      if (!r.ok) { setErr(r.loi ?? 'Có lỗi xảy ra.'); return; }
      onSaved();
      onClose();
    });

  return (
    <Card>
      <CardContent className="space-y-3">
        <h2 className="text-sm font-semibold">Sửa hồ sơ</h2>
        <CacO v={v} set={set} />
        {err && <p className="text-xs font-medium text-red-600">{err}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={submit}>
            {pending ? 'Đang lưu…' : 'Lưu thay đổi'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onClose}>Huỷ</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN');
}

interface ChiTiet {
  hoSo: NguoiNhan;
  donDaGui: DonTomTat[];
  monDangGiu: MonDangGiu[];
}

export function SoKol({
  nguoiNhan, q, idChon, chiTiet, canManage,
}: {
  nguoiNhan: NguoiNhan[];
  q: string;
  idChon?: string;
  chiTiet: ChiTiet | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dangThem, setDangThem] = useState(false);
  const [dangSua, setDangSua] = useState(false);
  const [dangDoiCoNgung, startDoiCoNgung] = useTransition();
  const [loiDoiCoNgung, setLoiDoiCoNgung] = useState<string | null>(null);

  const lamMoi = () => router.refresh();

  function doiCoNgung() {
    if (!chiTiet) return;
    const idDangSua = chiTiet.hoSo.id;
    const dichNgungDung = !chiTiet.hoSo.ngungDung;
    startDoiCoNgung(async () => {
      setLoiDoiCoNgung(null);
      const r = await doiNgungDung(idDangSua, dichNgungDung);
      if (!r.ok) setLoiDoiCoNgung(r.loi ?? 'Có lỗi xảy ra.'); else lamMoi();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <form action="/f/kol/nguoi-nhan" className="flex gap-2">
          <input
            name="q" defaultValue={q} placeholder="Tìm theo tên…"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
          <button type="submit" className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm hover:bg-muted">
            Tìm
          </button>
        </form>

        {canManage && !dangThem && (
          <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setDangThem(true)}>
            + Thêm hồ sơ
          </Button>
        )}
        {dangThem && <FormThem onClose={() => setDangThem(false)} />}

        <Card>
          <CardContent className="max-h-[70vh] space-y-0.5 overflow-y-auto p-2">
            {nguoiNhan.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {q ? `Không có hồ sơ nào khớp "${q}".` : 'Sổ KOL chưa có hồ sơ nào.'}
              </p>
            ) : nguoiNhan.map((n) => (
              <Link
                key={n.id}
                href={`/f/kol/nguoi-nhan?id=${n.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                className={`block rounded-md px-3 py-2 text-sm ${
                  n.id === idChon ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{n.ten}</span>
                  {n.ngungDung && (
                    <span className={`shrink-0 text-xs ${n.id === idChon ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      Ngừng dùng
                    </span>
                  )}
                </div>
                {n.kenh && (
                  <span className={`text-xs ${n.id === idChon ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {n.kenh}
                  </span>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {!chiTiet ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Chọn một hồ sơ ở danh sách bên trái để xem chi tiết, hoặc thêm hồ sơ mới.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{chiTiet.hoSo.ten}</h1>
                <p className="text-sm text-muted-foreground">
                  {[chiTiet.hoSo.kenh, chiTiet.hoSo.quocGia].filter(Boolean).join(' · ')}
                  {chiTiet.hoSo.ngungDung && ' · Ngừng dùng'}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setDangSua((s) => !s)}>
                      Sửa hồ sơ
                    </Button>
                    <Button
                      type="button" size="sm" variant="outline" disabled={dangDoiCoNgung}
                      onClick={doiCoNgung}
                    >
                      {dangDoiCoNgung ? 'Đang lưu…' : chiTiet.hoSo.ngungDung ? 'Bật lại dùng' : 'Ngừng dùng'}
                    </Button>
                  </div>
                  {loiDoiCoNgung && <p className="text-xs font-medium text-red-600">{loiDoiCoNgung}</p>}
                </div>
              )}
            </div>

            {dangSua && <FormSua hoSo={chiTiet.hoSo} onSaved={lamMoi} onClose={() => setDangSua(false)} />}

            <Card>
              <CardContent className="space-y-1 text-sm">
                <h2 className="mb-1 font-semibold">Thông tin liên hệ</h2>
                <p className="text-muted-foreground">Điện thoại: {chiTiet.hoSo.dienThoai ?? '—'}</p>
                <p className="text-muted-foreground">Email: {chiTiet.hoSo.email ?? '—'}</p>
                <p className="text-muted-foreground">
                  Địa chỉ: {[chiTiet.hoSo.diaChi, chiTiet.hoSo.thanhPho, chiTiet.hoSo.quocGia].filter(Boolean).join(', ') || '—'}
                </p>
                {chiTiet.hoSo.ghiChu && <p className="text-muted-foreground">Ghi chú: {chiTiet.hoSo.ghiChu}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2">
                <h2 className="font-semibold">Món đang giữ chưa trả ({chiTiet.monDangGiu.length})</h2>
                {chiTiet.monDangGiu.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Không giữ món nào của công ty.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr className="[&>th]:py-1.5 [&>th]:font-medium">
                        <th>Mã đơn</th><th>SKU</th><th>Tên hàng</th><th>Kho</th>
                        <th className="text-right">Còn nợ</th><th>Hạn trả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chiTiet.monDangGiu.map((m) => (
                        <tr key={m.dongDonId} className="border-b last:border-0 [&>td]:py-1.5">
                          <td><Link href={`/f/kol/${m.ma}`} className="underline-offset-2 hover:underline">{m.ma}</Link></td>
                          <td className="font-medium">{m.sku}</td>
                          <td className="text-muted-foreground">{m.tenHang ?? '—'}</td>
                          <td>{m.kho}</td>
                          <td className="text-right tabular-nums">{m.conNo}</td>
                          <td>{m.hanTra ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2">
                <h2 className="font-semibold">Đơn đã gửi ({chiTiet.donDaGui.length})</h2>
                {chiTiet.donDaGui.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có đơn nào gửi cho người này.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground">
                      <tr className="[&>th]:py-1.5 [&>th]:font-medium">
                        <th>Mã đơn</th><th>Mục đích</th><th className="text-right">Số dòng</th><th>Ngày gửi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chiTiet.donDaGui.map((d) => (
                        <tr key={d.id} className="border-b last:border-0 [&>td]:py-1.5">
                          <td><Link href={`/f/kol/${d.ma}`} className="underline-offset-2 hover:underline">{d.ma}</Link></td>
                          <td>{NHAN_MUC_DICH[d.mucDich]}</td>
                          <td className="text-right tabular-nums">{d.soDong}</td>
                          <td className="text-muted-foreground">{formatDate(d.guiLuc)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
