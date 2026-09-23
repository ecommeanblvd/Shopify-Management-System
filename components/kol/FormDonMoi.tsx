'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { taoDon, goiYGiaVon, traTonKhaDung } from '@/features/kol/actions';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import type { NguoiNhan } from '@/features/kol/queries';
import type { HinhThuc, MucDich } from '@/features/kol/types';

const NHAN_MUC_DICH: Record<MucDich, string> = { kol: 'KOL', chup_do: 'Chụp đồ', khac: 'Khác' };

interface DongState {
  key: string;
  sku: string;
  tenHang: string;
  kho: string;
  soLuong: string;
  hinhThuc: HinhThuc;
  hanTra: string;
  giaVon: string;
  giaVonTienTe: string;
  /** true khi giá vốn đang hiện là GỢI Ý hệ thống điền — người dùng gõ tay thì tắt cờ này. */
  giaVonTuGoiY: boolean;
  ton: number | null;
  tonDangTai: boolean;
}

function dongMoi(): DongState {
  return {
    key: crypto.randomUUID(),
    sku: '', tenHang: '', kho: WAREHOUSE_PRIORITY[0], soLuong: '1',
    hinhThuc: 'tang', hanTra: '', giaVon: '', giaVonTienTe: 'VND',
    giaVonTuGoiY: false, ton: null, tonDangTai: false,
  };
}

export function FormDonMoi({ nguoiNhan }: { nguoiNhan: NguoiNhan[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [nguoiNhanId, setNguoiNhanId] = useState('');
  const [mucDich, setMucDich] = useState<MucDich>('kol');
  const [ghiChu, setGhiChu] = useState('');
  const [dong, setDong] = useState<DongState[]>([dongMoi()]);

  const capNhat = (key: string, patch: Partial<DongState>) =>
    setDong((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const xoaDong = (key: string) => setDong((prev) => (prev.length > 1 ? prev.filter((d) => d.key !== key) : prev));

  const themDong = () => setDong((prev) => [...prev, dongMoi()]);

  /** Tra tồn khả dụng cho một dòng — gọi khi sku hoặc kho vừa chốt xong. */
  function refreshTon(key: string, sku: string, kho: string) {
    if (!sku.trim() || !kho.trim()) return;
    capNhat(key, { tonDangTai: true });
    start(async () => {
      const t = await traTonKhaDung(sku, kho);
      capNhat(key, { ton: t, tonDangTai: false });
    });
  }

  /** Gợi ý giá vốn khi rời khỏi ô mã hàng — chỉ điền nếu ô đang trống hoặc đang hiện gợi ý cũ. */
  function goiYGia(key: string, sku: string) {
    if (!sku.trim()) return;
    start(async () => {
      const g = await goiYGiaVon(sku);
      setDong((prev) => prev.map((d) => {
        if (d.key !== key) return d;
        if (d.giaVon.trim() && !d.giaVonTuGoiY) return d; // người dùng đã gõ tay — không đè
        return g ? { ...d, giaVon: g.gia, giaVonTienTe: g.tienTe, giaVonTuGoiY: true }
                 : { ...d, giaVon: '', giaVonTuGoiY: false };
      }));
    });
  }

  function onSkuBlur(key: string, sku: string, kho: string) {
    refreshTon(key, sku, kho);
    goiYGia(key, sku);
  }

  function onKhoChange(key: string, sku: string, kho: string) {
    capNhat(key, { kho });
    refreshTon(key, sku, kho);
  }

  function onHinhThucChange(key: string, hinhThuc: HinhThuc) {
    // Tặng thì KHÔNG được có hạn trả — xoá trống ngay khi đổi hình thức.
    capNhat(key, { hinhThuc, hanTra: hinhThuc === 'tang' ? '' : dong.find((d) => d.key === key)?.hanTra ?? '' });
  }

  const soDongThieuGia = dong.filter((d) => !d.giaVon.trim()).length;

  const submit = () =>
    start(async () => {
      setErr(null);
      if (!nguoiNhanId) { setErr('Phải chọn người nhận.'); return; }
      for (let i = 0; i < dong.length; i++) {
        const d = dong[i];
        const nhan = `Dòng ${i + 1}${d.sku ? ` (${d.sku})` : ''}`;
        if (!d.sku.trim()) { setErr(`${nhan}: thiếu mã hàng.`); return; }
        if (!d.kho.trim()) { setErr(`${nhan}: thiếu kho.`); return; }
        const sl = Number(d.soLuong);
        if (!Number.isInteger(sl) || sl <= 0) { setErr(`${nhan}: số lượng phải là số nguyên dương.`); return; }
        if (d.hinhThuc === 'muon' && !d.hanTra) { setErr(`${nhan}: hình thức mượn bắt buộc phải có hạn trả.`); return; }
      }

      const fd = new FormData();
      fd.set('nguoiNhanId', nguoiNhanId);
      fd.set('mucDich', mucDich);
      fd.set('ghiChu', ghiChu);
      fd.set('dong', JSON.stringify(dong.map((d) => ({
        sku: d.sku.trim(),
        tenHang: d.tenHang.trim() || undefined,
        kho: d.kho,
        soLuong: Number(d.soLuong),
        hinhThuc: d.hinhThuc,
        hanTra: d.hinhThuc === 'muon' ? d.hanTra : undefined,
        giaVon: d.giaVon.trim() || undefined,
        giaVonTienTe: d.giaVon.trim() ? d.giaVonTienTe : undefined,
      }))));

      const r = await taoDon(fd);
      if (!r.ok) setErr(r.loi ?? 'Có lỗi xảy ra.');
      else if (r.ma) router.push(`/f/kol/${r.ma}`);
    });

  const inputCls = 'block w-full h-9 rounded-md border border-input bg-background px-2 text-sm';

  return (
    <Card>
      <CardContent className="p-4 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block">Người nhận *</span>
            <select className={inputCls} value={nguoiNhanId} onChange={(e) => setNguoiNhanId(e.target.value)}>
              <option value="">— chọn —</option>
              {nguoiNhan.map((n) => (
                <option key={n.id} value={n.id}>{n.ten}{n.quocGia && n.quocGia !== 'VN' ? ` (${n.quocGia})` : ''}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block">Mục đích *</span>
            <select className={inputCls} value={mucDich} onChange={(e) => setMucDich(e.target.value as MucDich)}>
              {(Object.keys(NHAN_MUC_DICH) as MucDich[]).map((m) => (
                <option key={m} value={m}>{NHAN_MUC_DICH[m]}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block">Ghi chú</span>
          <textarea className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" rows={2}
            value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} />
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Dòng hàng</h2>
            <Button type="button" variant="outline" size="sm" onClick={themDong}>+ Thêm dòng</Button>
          </div>
          <div className="space-y-3">
            {dong.map((d, i) => {
              const sl = Number(d.soLuong);
              const vuotTon = d.ton !== null && Number.isFinite(sl) && sl > d.ton;
              return (
                <div key={d.key} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Dòng {i + 1}</span>
                    {dong.length > 1 && (
                      <button type="button" onClick={() => xoaDong(d.key)}
                        className="cursor-pointer text-xs text-red-600 hover:underline">Xoá dòng</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Mã hàng (SKU) *</span>
                      <input className={inputCls} value={d.sku}
                        onChange={(e) => capNhat(d.key, { sku: e.target.value })}
                        onBlur={(e) => onSkuBlur(d.key, e.target.value, d.kho)}
                        placeholder="VD ABC-123" />
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Kho *</span>
                      <select className={inputCls} value={d.kho}
                        onChange={(e) => onKhoChange(d.key, d.sku, e.target.value)}>
                        {WAREHOUSE_PRIORITY.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Số lượng *</span>
                      <input type="number" min={1} step={1} className={inputCls} value={d.soLuong}
                        onChange={(e) => capNhat(d.key, { soLuong: e.target.value })} />
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Hình thức *</span>
                      <select className={inputCls} value={d.hinhThuc}
                        onChange={(e) => onHinhThucChange(d.key, e.target.value as HinhThuc)}>
                        <option value="tang">Tặng</option>
                        <option value="muon">Mượn</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Tên hàng (tuỳ chọn)</span>
                      <input className={inputCls} value={d.tenHang}
                        onChange={(e) => capNhat(d.key, { tenHang: e.target.value })} />
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">
                        Hạn trả {d.hinhThuc === 'muon' ? '*' : '(chỉ áp dụng khi mượn)'}
                      </span>
                      <input type="date" className={inputCls} value={d.hanTra} disabled={d.hinhThuc !== 'muon'}
                        onChange={(e) => capNhat(d.key, { hanTra: e.target.value })} />
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Giá vốn</span>
                      <div className="flex gap-1">
                        <MoneyInput
                          value={d.giaVon}
                          decimals={d.giaVonTienTe === 'USD' ? 2 : 0}
                          onValueChange={(v) => capNhat(d.key, { giaVon: v, giaVonTuGoiY: false })}
                          className="flex-1"
                        />
                        <select className="h-9 rounded-md border border-input bg-background px-1 text-xs" value={d.giaVonTienTe}
                          onChange={(e) => capNhat(d.key, { giaVonTienTe: e.target.value })}>
                          <option value="VND">VND</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    </label>
                    <div className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Tồn khả dụng</span>
                      <div className="flex h-9 items-center">
                        {d.tonDangTai ? (
                          <span className="text-muted-foreground">đang tra…</span>
                        ) : d.ton === null ? (
                          <span className="text-muted-foreground">— chưa tra</span>
                        ) : (
                          <span className={vuotTon ? 'font-medium text-red-600' : 'font-medium'}>{d.ton}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {vuotTon && (
                    <p className="text-xs font-medium text-amber-600">
                      ⚠ Số lượng ({sl}) vượt tồn khả dụng ({d.ton}) của {d.sku} tại kho {d.kho} — có thể chốt đơn
                      ngay nhưng sẽ không giữ chỗ được cho tới khi nhập thêm hàng.
                    </p>
                  )}
                  {!d.giaVon.trim() && (
                    <p className="text-xs text-muted-foreground">Chưa tra được giá vốn — để trống, gõ tay nếu biết.</p>
                  )}
                </div>
              );
            })}
          </div>
          {soDongThieuGia > 0 && (
            <p className="text-xs font-medium text-amber-600">
              ⚠ {soDongThieuGia} dòng chưa có giá vốn — các dòng này sẽ KHÔNG vào báo cáo chi phí cho tới khi được điền
              (hệ thống sẽ tự tra lại khi đánh dấu đã gửi, nhưng có thể vẫn không tìm ra).
            </p>
          )}
        </div>

        {err && <p className="text-sm font-medium text-red-600">{err}</p>}
        <Button onClick={submit} disabled={pending}>{pending ? 'Đang tạo…' : 'Tạo đơn (nháp)'}</Button>
      </CardContent>
    </Card>
  );
}
