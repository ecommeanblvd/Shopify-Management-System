'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { locBox } from '@/features/dong-hang/loc-box';
import type { BoxHien } from '@/features/dong-hang/tron-box';

/**
 * Chọn box: ô tìm, BẤM VÀO MỚI BUNG danh sách Thùng / Túi (CEO 14/10/2026 — bản trước mở
 * sẵn, chiếm chỗ của mấy ô cân/kích thước ngay dưới). Gõ vài ký tự lọc nhanh cho người quen
 * việc, đọc cả lưới cho người mới — cùng một ô phục vụ cả hai.
 *
 * Danh sách bung THEO DÒNG chứ không thả nổi tuyệt đối: khối này nằm trong hộp thoại có
 * thanh cuộn riêng, panel tuyệt đối sẽ bị cắt mất ở mép hộp thoại.
 *
 * Đóng lại khi: chọn xong một box, bấm Esc, hoặc tiêu điểm rời khỏi cả cụm (kiểm bằng
 * `relatedTarget` thay vì nghe click toàn trang — không cần gỡ listener, không rò).
 *
 * Mọi luật lọc nằm ở `features/dong-hang/loc-box.ts` (thuần, có test) — ở đây chỉ còn việc vẽ.
 */
export function ChonBox({
  ds, chon, onChon,
}: { ds: BoxHien[]; chon: string | null; onChon: (b: BoxHien) => void }) {
  const [tuKhoa, setTuKhoa] = useState('');
  const [mo, setMo] = useState(false);

  const ketQua = useMemo(() => locBox(ds, tuKhoa), [ds, tuKhoa]);
  const thung = ketQua.filter((b) => b.loai === 'thung');
  const tui = ketQua.filter((b) => b.loai === 'tui');
  const boxDangChon = chon != null ? ds.find((b) => b.ma === chon) ?? null : null;

  const chonXong = (b: BoxHien) => {
    onChon(b);
    setTuKhoa('');
    setMo(false);
  };

  return (
    <div
      className="space-y-2"
      onBlur={(e) => {
        // Tiêu điểm nhảy sang một nút BÊN TRONG cụm (thẻ box) thì giữ nguyên; rời hẳn mới đóng.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMo(false);
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-9 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={tuKhoa}
          onChange={(e) => { setTuKhoa(e.target.value); setMo(true); }}
          onFocus={() => setMo(true)}
          onClick={() => setMo(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setMo(false); e.stopPropagation(); } }}
          role="combobox"
          aria-expanded={mo}
          aria-controls="danh-sach-box"
          placeholder={boxDangChon ? `${boxDangChon.ten} — bấm để đổi box` : 'Bấm để chọn box, hoặc gõ tên / số đo…'}
        />
      </div>

      {!mo ? null : ketQua.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {ds.length === 0
            // Danh mục rỗng (kho mới dựng, hoặc toàn bộ dòng kho thiếu kích thước) — vẫn phải
            // đóng được hàng, không được chờ ai điền danh mục trước.
            ? 'Chưa có box nào trong danh mục — gõ mã vào ô "Thùng đã dùng" ở dưới để đóng hàng ngay.'
            : 'Không thấy box khớp từ khoá này — gõ mã vào ô "Thùng đã dùng" ở dưới nếu đây là box chưa có trong danh mục.'}
        </p>
      ) : (
        <div id="danh-sach-box" className="max-h-56 space-y-3 overflow-y-auto rounded-lg border border-border p-2">
          {thung.length > 0 && <NhomBox nhan="Thùng" ds={thung} chon={chon} onChon={chonXong} />}
          {tui.length > 0 && <NhomBox nhan="Túi" ds={tui} chon={chon} onChon={chonXong} />}
        </div>
      )}
    </div>
  );
}

function NhomBox({
  nhan, ds, chon, onChon,
}: { nhan: string; ds: BoxHien[]; chon: string | null; onChon: (b: BoxHien) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{nhan}</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {ds.map((b) => {
          const daChon = chon != null && b.ma === chon;
          return (
            <button
              key={`${b.ten}-${b.ma}`}
              type="button"
              onClick={() => onChon(b)}
              aria-pressed={daChon}
              title={b.ma}
              className={`cursor-pointer rounded-lg border px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                daChon
                  ? 'border-blue-300 bg-blue-100/70 dark:border-blue-800/70 dark:bg-blue-900/35'
                  : 'border-border bg-background hover:bg-blue-50/60 dark:hover:bg-blue-950/25'
              }`}
            >
              <p className="truncate text-xs font-medium">{b.ten}</p>
              <p className="text-[11px] text-muted-foreground">
                {b.kichThuoc.daiCm}×{b.kichThuoc.rongCm}{b.kichThuoc.caoCm != null ? `×${b.kichThuoc.caoCm}` : ''} cm
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
