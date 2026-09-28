'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { KENH, TRANG, TRANG_THAI } from '@/features/danh-gia/phan-loai';
import { ghiDanhGia } from '@/features/danh-gia/actions';

function homNay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Form ghi đánh giá.
 *
 * HAI ô riêng cho nội dung khách và ghi chú CX — bảng Lark dồn cả hai vào một cột
 * `Reason` nên về sau không lọc được lời khách ra khỏi phân tích nội bộ.
 */
export function GhiDanhGia({ onXong }: { onXong: () => void }) {
  const [ngay, setNgay] = useState(homNay());
  const [soSao, setSoSao] = useState(1);
  const [trang, setTrang] = useState<string>('trustpilot');
  const [noiDung, setNoiDung] = useState('');
  const [ghiChuCx, setGhiChuCx] = useState('');
  const [trangThai, setTrangThai] = useState('');
  const [kenh, setKenh] = useState('');
  const [quocGia, setQuocGia] = useState('');
  const [email, setEmail] = useState('');
  const [ten, setTen] = useState('');
  const [maDon, setMaDon] = useState('');
  const [vendor, setVendor] = useState('');
  const [theoDoi, setTheoDoi] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function gui() {
    start(async () => {
      setLoi(null);
      const r = await ghiDanhGia({
        ngay, soSao, trang: trang || null,
        noiDung: noiDung.trim() || null,
        ghiChuCx: ghiChuCx.trim() || null,
        trangThai: trangThai || null,
        kenhLienHe: kenh || null,
        quocGia: quocGia.trim() || null,
        khachEmail: email.trim() || null,
        khachTen: ten.trim() || null,
        maDon: maDon.trim() || null,
        vendor: vendor.trim() || null,
        theoDoi: theoDoi.trim() || null,
      });
      if (!r.ok) { setLoi(r.loi ?? 'Ghi đánh giá thất bại.'); return; }
      toast.success(`Đã ghi đánh giá ${r.ma}.`, { duration: 3000 });
      onXong();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Ngày</span>
          <input
            type="date" value={ngay} onChange={(e) => setNgay(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium">Số sao</span>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n} type="button" onClick={() => setSoSao(n)}
                aria-label={`${n} sao`} aria-pressed={soSao === n}
                className={
                  'h-10 flex-1 cursor-pointer rounded-lg border text-sm transition-colors '
                  + (soSao === n
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input hover:bg-muted')
                }
              >
                {n}★
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Trang đánh giá</span>
          <select
            value={trang} onChange={(e) => setTrang(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— chưa rõ —</option>
            {TRANG.map((t) => <option key={t.ma} value={t.ma}>{t.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Trạng thái xử lý</span>
          <select
            value={trangThai} onChange={(e) => setTrangThai(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— chưa ghi —</option>
            {TRANG_THAI.map((t) => <option key={t.ma} value={t.ma}>{t.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Kênh liên hệ</span>
          <select
            value={kenh} onChange={(e) => setKenh(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— chưa rõ —</option>
            {KENH.map((k) => <option key={k.ma} value={k.ma}>{k.ten}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Quốc gia</span>
          <input
            value={quocGia} onChange={(e) => setQuocGia(e.target.value)}
            placeholder="United States"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Mã đơn</span>
          <input
            value={maDon} onChange={(e) => setMaDon(e.target.value)}
            placeholder="#MBLVD23597"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Brand tự điền nếu đơn chỉ có một brand
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Brand</span>
          <input
            value={vendor} onChange={(e) => setVendor(e.target.value)}
            placeholder="Để trống nếu chưa rõ"
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

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Tên khách</span>
          <input
            value={ten} onChange={(e) => setTen(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Nội dung khách viết</span>
        <textarea
          value={noiDung} onChange={(e) => setNoiDung(e.target.value)} rows={3}
          placeholder="Dán đúng lời khách, không viết lại"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Ghi chú của CX</span>
        <textarea
          value={ghiChuCx} onChange={(e) => setGhiChuCx(e.target.value)} rows={2}
          placeholder="Phân tích nội bộ — tách riêng khỏi lời khách"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Đã xử lý thế nào</span>
        <textarea
          value={theoDoi} onChange={(e) => setTheoDoi(e.target.value)} rows={2}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={gui} disabled={pending}>
          {pending ? 'Đang ghi…' : 'Ghi đánh giá'}
        </Button>
      </div>
    </div>
  );
}
