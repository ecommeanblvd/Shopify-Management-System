/**
 * THUẦN: lọc lưới chọn box theo ô tìm, và phát hiện người dùng đã gõ tay lệch số đo của box
 * đang chọn. Không I/O — xem spec `.superpowers/sdd/2026-10-14-chon-box-dong-hang/`.
 *
 * Vì sao luật nằm ở đây: bộ test của repo không bắt `.tsx` (`vitest.config.ts`), nên luật đặt
 * trong `ChonBox.tsx` là luật không ai canh. Component chỉ việc vẽ những gì module này trả ra.
 */

import type { BaChieu } from './kich-thuoc-box';
import type { BoxHien } from './tron-box';

/** Bỏ dấu tiếng Việt và hạ hoa/thường — để so từ khoá bất kể cách gõ. */
function boDau(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Chuỗi số đo dạng "DxRxC" (hoặc "DxR" nếu không có cao) để so khớp từ khoá dạng số. */
function chuoiSoDo(k: BaChieu): string {
  return k.caoCm != null ? `${k.daiCm}x${k.rongCm}x${k.caoCm}` : `${k.daiCm}x${k.rongCm}`;
}

/**
 * Lọc danh sách box cho lưới chọn.
 *
 * Box `loai === 'khac'` và box đã bị ẩn (`an = true`) KHÔNG BAO GIỜ hiện, bất kể từ khoá —
 * đây là hai cờ ẩn hẳn khỏi màn chọn, không phải điều kiện lọc theo tìm kiếm.
 *
 * Từ khoá rỗng → nguyên danh sách (sau khi bỏ hai loại trên): người mới đọc cả lưới,
 * người quen gõ vài ký tự để lọc nhanh (CEO chốt khi duyệt mockup).
 */
export function locBox(ds: BoxHien[], tuKhoa: string): BoxHien[] {
  const hien = ds.filter((b) => !b.an && b.loai !== 'khac');
  const tu = boDau(tuKhoa.trim());
  if (!tu) return hien;
  return hien.filter((b) => boDau(b.ten).includes(tu) || chuoiSoDo(b.kichThuoc).includes(tu));
}

/**
 * Người dùng đã gõ tay lệch số đo của box đang chọn chưa (so với `kichThuoc` của chính box đó)?
 *
 * `box = null` (chưa chọn box nào từ danh mục, hoặc đang gõ mã tay cho box lạ) → luôn `false`:
 * không có box để so, nên không có "sửa" nào cả.
 *
 * Box hai số (`caoCm = null`, túi) — ô Cao ĐÚNG là phải để trống; người gõ bất kỳ gì vào đó
 * (kể cả "0") tức đã lệch khỏi box, vì box này không có chiều cao.
 */
export function daSuaDim(box: BaChieu | null, dang: { dai: string; rong: string; cao: string }): boolean {
  if (!box) return false;

  const soDai = Number(dang.dai.trim().replace(',', '.'));
  const soRong = Number(dang.rong.trim().replace(',', '.'));
  if (!Number.isFinite(soDai) || soDai !== box.daiCm) return true;
  if (!Number.isFinite(soRong) || soRong !== box.rongCm) return true;

  const caoRaw = dang.cao.trim();
  if (box.caoCm === null) return caoRaw !== '';

  if (caoRaw === '') return true;
  const soCao = Number(caoRaw.replace(',', '.'));
  return !Number.isFinite(soCao) || soCao !== box.caoCm;
}
