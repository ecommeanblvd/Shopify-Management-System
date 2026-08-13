/**
 * Quốc kỳ hiển thị bằng ẢNH SVG self-host (public/flags/<iso2>.svg).
 *
 * KHÔNG dùng emoji cờ (regional indicator): Windows không có glyph cờ trong
 * Segoe UI Emoji nên máy nhân sự chỉ thấy 2 chữ mã nước (13/08) — Mac thì hiện
 * bình thường, nên lỗi rất dễ bị bỏ sót. SVG cho kết quả giống nhau mọi máy.
 *
 * Server-safe: chỉ là <img>, không cần 'use client'. Mã nước lạ / thiếu file →
 * trình duyệt hiện `alt` = mã nước, tức tự quay về đúng hành vi cũ.
 */
export function CountryFlag({ code, className = '' }: { code: string | null | undefined; className?: string }) {
  const cc = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh trong public, next/image không cần thiết (và làm nặng thêm)
    <img
      src={`/flags/${cc.toLowerCase()}.svg`}
      alt={cc}
      title={cc}
      loading="lazy"
      className={`inline-block h-[0.85em] w-[1.133em] shrink-0 rounded-[2px] object-cover align-[-0.08em] ring-1 ring-black/10 dark:ring-white/15 ${className}`}
    />
  );
}
