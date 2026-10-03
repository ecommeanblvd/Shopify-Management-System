'use client';

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

/** Một nhóm ảnh. Rỗng thì KHÔNG vẽ gì — khối trống chỉ làm modal dài ra. */
function NhomAnh({ ten, ds }: { ten: string; ds: FileLark[] }) {
  if (ds.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {ten} · {ds.length}
      </p>
      <div className="flex flex-wrap gap-2">
        {ds.map((f) => (
          <a
            key={f.token} href={duong(f)} target="_blank" rel="noreferrer" title={f.ten}
            className="block cursor-pointer rounded-lg border border-border transition-colors hover:border-ring"
          >
            {laAnh(f) ? (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh qua route nội bộ có kiểm quyền, không qua optimiser của Next
              <img src={`${duong(f)}?w=320`} alt={f.ten} loading="lazy"
                   className="size-28 rounded-lg object-cover" />
            ) : (
              <span className="grid size-28 place-items-center rounded-lg text-xs text-muted-foreground">
                PDF
              </span>
            )}
          </a>
        ))}
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
      <NhomAnh ten="Ảnh chụp lỗi QC" ds={dong.anhLoiQc} />
    </div>

    <NhomAnh ten="Ảnh thực tế sản phẩm" ds={dong.anhHangDen} />
    <NhomAnh ten="Biên bản bàn giao" ds={dong.bbBanGiao} />

    {dong.dinhDanh && (
      <O nhan="Định danh">
        <span className="font-mono text-xs text-muted-foreground">{dong.dinhDanh}</span>
      </O>
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
