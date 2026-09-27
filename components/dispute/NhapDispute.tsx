'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NHAN_LY_DO, NHAN_TRANG_THAI, TRANG_THAI } from '@/features/dispute/chuan-hoa';
import { nhapDispute } from '@/features/dispute/actions';

/**
 * Nhập tay một ca PayPal / Stripe.
 *
 * KHÔNG có lựa chọn Shopify Payments: ca của cổng đó tự về qua đồng bộ, nhập tay
 * là sinh bản thứ hai cho cùng một ca. Action cũng chặn lại lần nữa ở máy chủ.
 */
export function NhapDispute({
  stores, onXong,
}: { stores: { id: string; name: string }[]; onXong: () => void }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [cong, setCong] = useState('paypal');
  const [maHoSo, setMaHoSo] = useState('');
  const [trangThai, setTrangThai] = useState('needs_response');
  const [lyDo, setLyDo] = useState('');
  const [soTien, setSoTien] = useState('');
  const [tienTe, setTienTe] = useState('USD');
  const [phi, setPhi] = useState('');
  const [moLuc, setMoLuc] = useState('');
  const [hanNop, setHanNop] = useState('');
  const [maDon, setMaDon] = useState('');
  const [email, setEmail] = useState('');
  const [ghiChu, setGhiChu] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function gui() {
    start(async () => {
      setLoi(null);
      const r = await nhapDispute({
        storeId, congThanhToan: cong,
        maHoSo: maHoSo.trim() || null,
        trangThai, lyDo: lyDo || null,
        soTien, tienTe,
        phiDispute: phi.trim() || null,
        moLuc: moLuc || null, hanNop: hanNop || null,
        maDon: maDon.trim() || null,
        khachEmail: email.trim() || null,
        ghiChu: ghiChu.trim() || null,
      });
      if (!r.ok) { setLoi(r.loi ?? 'Nhập thất bại.'); return; }
      toast.success('Đã ghi ca tranh chấp.', { duration: 3000 });
      onXong();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Store</span>
          <select
            value={storeId} onChange={(e) => setStoreId(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Cổng thanh toán</span>
          <select
            value={cong} onChange={(e) => setCong(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="paypal">PayPal</option>
            <option value="stripe">Stripe</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Số tiền</span>
          <input
            value={soTien} onChange={(e) => setSoTien(e.target.value)}
            inputMode="decimal" placeholder="312.99"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Đơn vị tiền</span>
          <input
            value={tienTe} onChange={(e) => setTienTe(e.target.value.toUpperCase())}
            maxLength={3} placeholder="USD"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm uppercase"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Bắt buộc — số tiền không có đơn vị sẽ bị loại khỏi mọi bảng tổng
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Trạng thái</span>
          <select
            value={trangThai} onChange={(e) => setTrangThai(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {TRANG_THAI.map((t) => <option key={t} value={t}>{NHAN_TRANG_THAI[t]}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Lý do</span>
          <select
            value={lyDo} onChange={(e) => setLyDo(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— chưa rõ —</option>
            {Object.entries(NHAN_LY_DO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Ngày mở</span>
          <input
            type="date" value={moLuc} onChange={(e) => setMoLuc(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Hạn nộp bằng chứng</span>
          <input
            type="date" value={hanNop} onChange={(e) => setHanNop(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Mã đơn</span>
          <input
            value={maDon} onChange={(e) => setMaDon(e.target.value)}
            placeholder="#MBLVD22140"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Mã hồ sơ của CX</span>
          <input
            value={maHoSo} onChange={(e) => setMaHoSo(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Phí dispute</span>
          <input
            value={phi} onChange={(e) => setPhi(e.target.value)}
            inputMode="decimal" placeholder="15.00"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email khách</span>
          <input
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Ghi chú</span>
        <textarea
          value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={2}
          placeholder="Diễn biến, đã nộp gì cho cổng thanh toán"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={gui} disabled={pending}>
          {pending ? 'Đang ghi…' : 'Ghi ca tranh chấp'}
        </Button>
      </div>
    </div>
  );
}
