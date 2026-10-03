'use client';

import { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { nhomQc, nhomKho, tenBrand, tachTenBienThe } from '@/features/kho-nhan/dong-so-nhap';
import { mauKho, mauLoaiNhap } from '@/features/kho-nhan/mau-nhan';
import type { DongSoNhap, FileLark } from '@/features/kho-nhan/types';

/**
 * Chi tiết MỘT dòng Sổ nhập (CEO 03/10/2026: "chưa click vào record dòng nào để mở modal ra xem
 * chi tiết được").
 *
 * Bảng có 16 cột trên một dòng cao 38px, nên gần như cột nào cũng cắt chữ — `title` chỉ cứu được
 * người đang rê chuột và không cứu được gì trên máy cảm ứng. Modal là chỗ đọc ĐỦ: lý do lỗi dài
 * xuống dòng thoải mái, ảnh xem cỡ lớn chứ không phải ô 28px.
 *
 * KHÔNG gọi thêm dữ liệu: mọi thứ cần đã nằm trong dòng bảng đang có. Thêm một lượt đọc máy chủ
 * ở đây là tự dựng một nguồn thứ hai cho cùng một sự thật, rồi hai bên lệch nhau.
 */

const MAU_CHAM: Record<string, string> = {
  dat: 'bg-emerald-500', hong: 'bg-red-500', cho: 'bg-amber-500',
  du: 'bg-sky-500', khac: 'bg-muted-foreground',
};
const CHU_KHO: Record<string, string> = {
  luu: 'text-sky-600 dark:text-sky-400', tam: 'text-foreground',
  cho: 'text-amber-600 dark:text-amber-400', tra: 'text-violet-600 dark:text-violet-400',
  khac: 'text-foreground',
};

const duong = (f: FileLark) => `/api/kho-nhan/anh-lark/${f.token}`;
const laAnh = (f: FileLark) => !/\.pdf$/i.test(f.ten);

function ngayVn(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** Một ô nhãn - giá trị. Giá trị trống hiện gạch ngang chứ không để khoảng trắng. */
function O({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{nhan}</p>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

const hoacGach = (s: string | null) => (s ?? '').trim() || '—';

/**
 * Một nhóm ảnh. Rỗng thì KHÔNG vẽ gì — khối trống chỉ làm modal dài ra.
 *
 * Ảnh là NÚT mở khung xem ngay trong trang, không phải liên kết `target="_blank"` (CEO
 * 03/10/2026: "bấm vào thì mở modal ảnh luôn tại tab url đó thay vì bị đổi sang tab khác").
 * Nhảy tab là mất chỗ đang đứng: quay lại thì modal chi tiết đã đóng, phải tìm lại dòng từ đầu.
 *
 * PDF cũng mở tại chỗ (CEO 03/10/2026), nhúng bằng <iframe> để dùng trình đọc sẵn có của trình
 * duyệt. Vẫn chừa một đường mở tab mới trong khung xem, cho trình duyệt nào chặn nhúng PDF.
 */
function NhomAnh({ ten, ds, onMo }: { ten: string; ds: FileLark[]; onMo: (i: number) => void }) {
  if (ds.length === 0) return null;
  const vien = 'block cursor-pointer rounded-lg border border-border transition-colors hover:border-ring';
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {ten} · {ds.length}
      </p>
      <div className="flex flex-wrap gap-2">
        {ds.map((f, i) => (
          <button key={f.token} type="button" title={f.ten} onClick={() => onMo(i)}
                  aria-label={`Xem to ${f.ten}`} className={vien}>
            {laAnh(f) ? (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh qua route nội bộ có kiểm quyền, không qua optimiser của Next
              <img src={`${duong(f)}?w=320`} alt={f.ten} loading="lazy"
                   className="size-28 rounded-lg object-cover" />
            ) : (
              <span className="grid size-28 place-items-center rounded-lg text-xs text-muted-foreground">
                PDF
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Khung xem ảnh to, phủ lên modal chi tiết — KHÔNG phải một `Dialog` thứ hai.
 *
 * Vì sao không lồng `Dialog`: hai lớp Radix chồng nhau tranh nhau tiêu điểm và phím Esc, lớp
 * ngoài hay đóng theo lớp trong. Một lớp phủ `fixed` tự quản ba phím là đủ và đoán được.
 *
 * Esc đóng ĐÚNG khung ảnh, không đóng luôn modal chi tiết: `stopPropagation` chặn sự kiện trước
 * khi nó tới người nghe ở cấp tài liệu của Radix. Người đang xem ảnh bấm Esc là muốn quay về
 * danh sách ảnh, không phải mất cả trang chi tiết.
 */
export function KhungXemAnh({ ds, i, onDoi, onDong }: {
  ds: FileLark[]; i: number; onDoi: (i: number) => void; onDong: () => void;
}) {
  const f = ds[i];
  if (!f) return null;
  const doi = (b: number) => onDoi((i + b + ds.length) % ds.length);
  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Ảnh ${i + 1} trên ${ds.length}: ${f.ten}`}
      tabIndex={-1}
      ref={(el) => { el?.focus(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onDong(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); doi(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); doi(1); }
      }}
      /* Bấm ra nền thì đóng; bấm vào chính tấm ảnh thì không. */
      onClick={onDong}
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 outline-none"
    >
      <div className="flex shrink-0 items-center gap-3 px-4 py-3 text-white">
        <span className="truncate text-sm">{f.ten}</span>
        {ds.length > 1 && (
          <span className="ml-auto text-xs tabular-nums text-white/70">{i + 1}/{ds.length}</span>
        )}
        {/* Đường lùi cho trình duyệt chặn nhúng PDF — và cho người muốn giữ tệp lại để đọc kỹ. */}
        {!laAnh(f) && (
          <a href={duong(f)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
             className="cursor-pointer text-xs text-white/70 underline hover:text-white">
            Mở ở tab mới
          </a>
        )}
        <button type="button" onClick={onDong} aria-label="Đóng"
                className={`${ds.length > 1 ? '' : 'ml-auto'} grid size-9 cursor-pointer place-items-center rounded-full hover:bg-white/15`}>
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {laAnh(f) ? (
          // eslint-disable-next-line @next/next/no-img-element -- như trên
          <img src={duong(f)} alt={f.ten} onClick={(e) => e.stopPropagation()}
               className="max-h-full max-w-full object-contain" />
        ) : (
          /* PDF: dùng trình đọc sẵn có của trình duyệt. Route phục vụ file đặt
             `Content-Disposition: inline` nên tệp hiện ra chứ không rơi xuống thư mục tải về. */
          <iframe src={duong(f)} title={f.ten} onClick={(e) => e.stopPropagation()}
                  className="h-full w-full rounded-lg bg-white" />
        )}
        {ds.length > 1 && (
          <>
            <button type="button" aria-label="Ảnh trước"
                    onClick={(e) => { e.stopPropagation(); doi(-1); }}
                    className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <ChevronLeftIcon className="size-5" />
            </button>
            <button type="button" aria-label="Ảnh sau"
                    onClick={(e) => { e.stopPropagation(); doi(1); }}
                    className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <ChevronRightIcon className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * NỘI DUNG của modal, tách khỏi lớp vỏ hộp thoại.
 *
 * Vì sao tách: `Dialog` của Radix vẽ qua Portal nên kết xuất phía máy chủ ra chuỗi RỖNG — không
 * bài test nào chạm được vào nội dung. Repo chưa có jsdom và cũng chưa cần: phần đáng kiểm ở
 * đây là nội dung, không phải cơ chế mở/đóng của Radix.
 */
export function NoiDungChiTiet({ dong }: { dong: DongSoNhap }) {
  const { ten, bienThe } = tachTenBienThe(dong.lineitemName);
  const mq = nhomQc(dong.qcCheck);
  const mk = nhomKho(dong.whAction);
  const brand = tenBrand(dong.vendorFinal, dong.sku);
  /* Nhóm ảnh đang mở và vị trí trong nhóm. Giữ cả MẢNG chứ không giữ tên nhóm: ba nhóm ảnh là
   * ba danh sách rời, lật qua lại chỉ nên quanh quẩn trong nhóm người vừa bấm. */
  const [xemAnh, setXemAnh] = useState<{ ds: FileLark[]; i: number } | null>(null);
  const mo = (ds: FileLark[]) => (i: number) => setXemAnh({ ds, i });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <O nhan="Sản phẩm">
          <span>{ten || '—'}</span>
          {bienThe && <span className="text-muted-foreground"> · {bienThe}</span>}
        </O>
        <O nhan="SKU"><span className="font-mono text-[13px]">{hoacGach(dong.sku)}</span></O>
        <O nhan="Brand">
          {brand
            ? <span className={brand.suyRa ? 'text-muted-foreground' : undefined}>
                {brand.ten}{brand.suyRa && <span className="text-xs"> (suy từ SKU)</span>}
              </span>
            : '—'}
        </O>
        <O nhan="Số lượng"><span className="tabular-nums">{dong.soLuong ?? 1}</span></O>
        <O nhan="Store">{hoacGach(dong.storeFinal)}</O>
        <O nhan="Ngày nhập kho">{ngayVn(dong.ngayImport)}</O>
        <O nhan="Kho">
          {dong.warehouse
            ? <span className={`rounded-full px-1.5 py-0.5 text-xs ${mauKho(dong.warehouse)}`}>{dong.warehouse}</span>
            : '—'}
        </O>
        <O nhan="Loại nhập">
          {dong.inventoryType
            ? <span className={`rounded-full px-1.5 py-0.5 text-xs ${mauLoaiNhap(dong.inventoryType)}`}>{dong.inventoryType}</span>
            : '—'}
        </O>
        <O nhan="Xử lý kho">
          <span className={CHU_KHO[mk]}>{hoacGach(dong.whAction)}</span>
        </O>
        {/* Dòng do hệ thống tạo hay đội kho gõ thẳng trên Lark — cùng thông tin cột `Nguồn`
            của bảng, để người đọc modal không phải quay ra bảng mới biết. */}
        <O nhan="Nguồn">
          <span className={`whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium ${
            dong.cuaHeThong
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'}`}
          >
            {dong.cuaHeThong ? 'Hệ thống' : 'Lark'}
          </span>
        </O>
    </div>

    {/* Khối QC tách riêng: đây là thứ người mở modal muốn đọc, và là thứ cột hẹp cắt mất. */}
    <div className={`space-y-3 rounded-lg border p-3 ${
      mq === 'hong' ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-border'}`}
    >
      <O nhan="Kết quả QC">
        <span className="flex items-center gap-1.5">
          <span className={`size-1.5 shrink-0 rounded-full ${MAU_CHAM[mq]}`} />
          {hoacGach(dong.qcCheck)}
        </span>
      </O>
      <O nhan="Lý do lỗi">
        {/* Chữ NGƯỜI gõ trên Lark, giữ nguyên xuống dòng — không rút gọn, không sửa chính tả. */}
        <span className="whitespace-pre-wrap">{hoacGach(dong.lyDoFail)}</span>
      </O>
      <NhomAnh ten="Ảnh chụp lỗi QC" ds={dong.anhLoiQc} onMo={mo(dong.anhLoiQc)} />
    </div>

    <NhomAnh ten="Ảnh thực tế sản phẩm" ds={dong.anhHangDen} onMo={mo(dong.anhHangDen)} />
    <NhomAnh ten="Biên bản bàn giao" ds={dong.bbBanGiao} onMo={mo(dong.bbBanGiao)} />

    {dong.dinhDanh && (
      <O nhan="Định danh">
        <span className="font-mono text-xs text-muted-foreground">{dong.dinhDanh}</span>
      </O>
    )}

    {xemAnh && (
      <KhungXemAnh
        ds={xemAnh.ds} i={xemAnh.i}
        onDoi={(k) => setXemAnh({ ds: xemAnh.ds, i: k })}
        onDong={() => setXemAnh(null)}
      />
    )}
  </div>
  );
}

export function ChiTietDong({ dong, onDong }: { dong: DongSoNhap | null; onDong: () => void }) {
  if (!dong) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onDong(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
        <DialogTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-6">
          <span className="font-mono text-base">{hoacGach(dong.orderNumber)}</span>
          <span className="text-sm font-normal text-muted-foreground">{dong.uniqueCode ?? '—'}</span>
        </DialogTitle>
        <DialogDescription className="sr-only">
          Chi tiết một dòng của Sổ nhập kho, dựng từ bản sao bảng Lark WH - Inventory.
        </DialogDescription>
        <NoiDungChiTiet dong={dong} />
      </DialogContent>
    </Dialog>
  );
}
