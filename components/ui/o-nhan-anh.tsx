'use client';

import { useRef, useState } from 'react';

/**
 * Bọc một `<input type="file">` để nhận ảnh bằng DÁN (Ctrl/Cmd+V) và KÉO THẢ (CEO 01/10/2026:
 * "các ô upload ảnh đều cho phép copy ảnh từ 1 nơi khác — ví dụ Zalo, tin nhắn — rồi paste").
 *
 * GIỮ NGUYÊN input thật bên trong và chỉ gán `files` vào nó, nên đường gửi form không đổi một
 * dòng nào: vẫn là `name` đó, vẫn `required` đó, máy chủ đọc y như cũ. Dựng một đường tải ảnh
 * riêng cạnh đường form đang chạy là đúng loại lỗi "hai nguồn cho một việc" đã sửa cả ngày.
 *
 * Ảnh dán từ Zalo vào clipboard không có tên tệp — đặt tên theo thời điểm để máy chủ và người
 * đọc về sau còn phân biệt được, thay vì một loạt "image.png" chồng nhau.
 */
export function ONhanAnh({ name, required, disabled, className, goiY }: {
  name: string; required?: boolean; disabled?: boolean; className?: string; goiY?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [ten, setTen] = useState<string | null>(null);
  const [keo, setKeo] = useState(false);

  const dat = (fs: File[]) => {
    const anh = fs.filter((f) => f.type.startsWith('image/'));
    if (anh.length === 0 || !ref.current) return;
    const dt = new DataTransfer();
    const f = anh[0];
    dt.items.add(f.name && f.name !== 'image.png'
      ? f
      : new File([f], `dan-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }));
    ref.current.files = dt.files;
    setTen(dt.files[0]?.name ?? null);
  };

  return (
    <div
      onPaste={(e) => {
        if (disabled) return;
        const fs = Array.from(e.clipboardData?.files ?? []);
        if (fs.length === 0) return;
        e.preventDefault(); dat(fs);
      }}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setKeo(true); } }}
      onDragLeave={() => setKeo(false)}
      onDrop={(e) => {
        if (disabled) return;
        setKeo(false);
        const fs = Array.from(e.dataTransfer?.files ?? []);
        if (fs.length === 0) return;
        e.preventDefault(); dat(fs);
      }}
      tabIndex={disabled ? -1 : 0}
      className={`rounded-md border border-dashed p-1.5 outline-none focus-visible:border-ring
        ${keo ? 'border-primary bg-primary/5' : 'border-border'} ${disabled ? 'opacity-60' : ''}`}
    >
      <input ref={ref} name={name} type="file" accept="image/*" required={required} disabled={disabled}
        onChange={(e) => setTen(e.target.files?.[0]?.name ?? null)} className={className} />
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
        {ten ? `đã chọn: ${ten}` : (goiY ?? 'Bấm chọn, kéo thả, hoặc bấm vào đây rồi Ctrl/Cmd+V — copy thẳng từ Zalo là dán được')}
      </p>
    </div>
  );
}
