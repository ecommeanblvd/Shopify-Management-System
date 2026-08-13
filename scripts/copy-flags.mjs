/**
 * Copy SVG quốc kỳ (flag-icons, 4x3) → public/flags/ để app tự phục vụ.
 *
 * Vì sao cần: emoji cờ (regional indicator) KHÔNG render trên Windows — Segoe
 * UI Emoji không có glyph cờ, nên nhân sự dùng Windows chỉ thấy 2 chữ mã nước
 * (báo cáo 13/08). SVG self-host hiển thị giống nhau trên mọi máy, và không
 * phụ thuộc CDN ngoài (app nội bộ vẫn chạy khi mạng ra ngoài bị chặn).
 *
 * Chạy tự động qua `postinstall`; public/flags/ nằm trong .gitignore để không
 * commit 271 file vào repo.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'node_modules', 'flag-icons', 'flags', '4x3');
const DEST = path.join(process.cwd(), 'public', 'flags');

async function main() {
  if (!existsSync(SRC)) {
    // Không có package (vd cài production thiếu dep) → bỏ qua, UI tự fallback
    // sang mã nước dạng chữ. Không làm vỡ install.
    console.warn('[copy-flags] bỏ qua: không thấy flag-icons trong node_modules');
    return;
  }
  await mkdir(DEST, { recursive: true });
  await cp(SRC, DEST, { recursive: true });
  const n = (await readdir(DEST)).length;
  console.log(`[copy-flags] đã copy ${n} cờ → public/flags/`);
}

main().catch((e) => {
  console.warn('[copy-flags] lỗi (bỏ qua, UI fallback mã nước):', e?.message ?? e);
});
