'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { timMonChuaNhan } from '@/features/kho-nhan/tim-don';
import type { KetQuaTim } from '@/features/kho-nhan/types';
import {
  ghiNhanChiec, ghiNhanChiecPo, ghiNhanChiecMonLark, ghiNhanChiecReturn,
} from '@/features/kho-nhan/nhan-actions';

const TOI_THIEU = 2;
const DEBOUNCE_MS = 250;

/**
 * Ô tìm món chờ nhận — CỬA DUY NHẤT của luồng nhận hàng (CEO 24/09: không có
 * danh sách "Chờ về" dựng sẵn).
 *
 * Gõ mã đơn, SKU, tên sản phẩm (không dấu được), hoặc quét mã sản phẩm. Bấm một
 * dòng là ghi nhận một chiếc ở trạng thái ĐANG KIỂM — chưa vào tồn.
 */
export function OTimMonChoVe({ onDaNhan }: { onDaNhan: () => void }) {
  const [q, setQ] = useState('');
  const [ds, setDs] = useState<KetQuaTim[]>([]);
  const [dangTim, setDangTim] = useState(false);
  /**
   * Lỗi GỌI, tách hẳn khỏi "không có kết quả".
   *
   * Bản đầu bọc lượt gọi trong try/finally KHÔNG CÓ catch, nên một server action
   * chết cũng hiện thành "Không có món nào chờ về khớp …". Ngày 24/09 module
   * `shopify-qc` nổ `ReferenceError` trên production và màn im lặng báo không có
   * kết quả — CEO thử ba lần, không ai biết vì sao. Không bao giờ để một lỗi
   * đội lốt một kết quả rỗng nữa.
   */
  const [loiGoi, setLoiGoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const luotRef = useRef(0);

  useEffect(() => {
    const ky = q.trim();
    if (ky.length < TOI_THIEU) return;
    const luot = ++luotRef.current;
    const t = setTimeout(async () => {
      setDangTim(true);
      try {
        const r = await timMonChuaNhan(ky);
        if (luot !== luotRef.current) return;
        setDs(r);
        setLoiGoi(null);
      } catch (e) {
        if (luot !== luotRef.current) return;
        console.error('[kho-nhan] tìm món lỗi:', e);
        setDs([]);
        setLoiGoi('Không gọi được máy chủ để tìm. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.');
      } finally {
        if (luot === luotRef.current) setDangTim(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const ky = q.trim();
  // SUY RA, không lưu: từ khoá ngắn lại thì kết quả cũ không được phép còn hiện.
  const hienThi = ky.length < TOI_THIEU ? [] : ds;

  function nhan(m: KetQuaTim) {
    start(async () => {
      /* Bốn nguồn, bốn lệnh. Ba nguồn ngoài Shopify không thuộc đơn Shopify nào (đồ return thì
       * có mã đơn, nhưng đơn ĐÃ GIAO XONG nên không được gắn vào `order_id`), và mỗi nguồn có
       * luật "còn nhận được không" riêng — gộp một lệnh rồi đoán nguồn bên trong là chỗ sớm
       * muộn cũng nhận sai nguồn. */
      const r = m.nguon === 'po' ? await ghiNhanChiecPo(m.lineId)
        : m.nguon === 'mon' ? await ghiNhanChiecMonLark(m.lineId)
        : m.nguon === 'return' ? await ghiNhanChiecReturn(m.lineId)
        : await ghiNhanChiec(m.lineId);
      if (!r.ok) { toast.error(r.loi ?? 'Ghi nhận thất bại.', { duration: 10000 }); return; }
      toast.success(`Đã nhận 1 chiếc ${m.sku ?? ''} — đang chờ kiểm.`, { duration: 3000 });
      setQ('');
      setDs([]);
      onDaNhan();
    });
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Tìm món chờ về</span>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setLoiGoi(null); }}
          placeholder="Mã đơn, SKU, tên sản phẩm — hoặc quét mã sản phẩm"
          aria-label="Tìm món chờ về theo mã đơn, SKU, tên sản phẩm hoặc mã sản phẩm"
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
        />
      </label>

      {loiGoi && <p className="text-sm text-destructive">{loiGoi}</p>}

      {ky.length >= TOI_THIEU && (
        <div className="rounded-lg border border-border">
          {loiGoi ? (
            <p className="px-3 py-4 text-sm text-destructive">Không tìm được — xem thông báo ở trên.</p>
          ) : dangTim && hienThi.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Đang tìm…</p>
          ) : hienThi.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Không có món nào chờ về khớp “{ky}”.
            </p>
          ) : (
            <ul>
              {hienThi.map((m) => (
                <li key={m.lineId} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => nhan(m)}
                    disabled={pending}
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.tenSanPham ?? m.sku}
                        {m.tenBienThe && <span className="text-muted-foreground"> — {m.tenBienThe}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.nguon === 'po' && (
                          <span className="mr-1 rounded bg-violet-500/15 px-1 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                            PO
                          </span>
                        )}
                        {/* Kênh không-Shopify: nhãn đọc ngay ra tên kênh, vì mã `#MXHS1560` thì
                            chỉ người trong nghề mới biết là Xiao Hong Shu. Màu khác PO để quét
                            bảng không phải đọc chữ. */}
                        {/* Đồ khách trả về: nhãn phải đọc ra NGAY, vì mã đơn của nó trông y hệt
                            đơn bán bình thường (`#MBLVD29466`) — không có nhãn thì kho tưởng
                            đang nhận hàng mới của đơn đó. */}
                        {m.nguon === 'return' && (
                          <span className="mr-1 rounded bg-rose-500/15 px-1 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
                            Khách trả
                          </span>
                        )}
                        {m.nguon === 'mon' && (
                          <span className="mr-1 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                            {m.maDon.startsWith('#MTB') ? 'Taobao'
                              : m.maDon.startsWith('#MXHS') ? 'Xiao Hong Shu' : 'Kênh Lark'}
                          </span>
                        )}
                        {m.maDon} · <span className="font-mono">{m.sku}</span>
                        {m.vendor && ` · ${m.vendor}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      đã nhận {m.daNhan}/{m.datSl}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
