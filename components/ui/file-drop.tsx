'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';

/**
 * Vùng KÉO THẢ tệp dùng chung: thả cả loạt file vào, hoặc bấm để chọn như cũ.
 * Không tự xử lý gì — trả `FileList`/mảng file cho nơi dùng, để mỗi luồng tải tự quyết cách xử lý.
 */
export function FileDrop({ accept, multiple = true, disabled = false, onFiles, tieuDe, goiY, children }: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  tieuDe?: string;
  goiY?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [dangKeo, setDangKeo] = useState(false);

  const nhan = (list: FileList | null) => {
    const fs = Array.from(list ?? []);
    if (fs.length) onFiles(multiple ? fs : fs.slice(0, 1));
    if (ref.current) ref.current.value = '';
  };

  return (
    <div
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDangKeo(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDangKeo(false); }}
      onDrop={(e) => { if (disabled) return; e.preventDefault(); setDangKeo(false); nhan(e.dataTransfer.files); }}
      onClick={() => { if (!disabled) ref.current?.click(); }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ref.current?.click(); } }}
      aria-disabled={disabled}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        disabled ? 'cursor-not-allowed opacity-60 border-border' : 'cursor-pointer hover:border-primary/60 hover:bg-muted/40'
      } ${dangKeo ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'}`}
    >
      <input ref={ref} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => nhan(e.target.files)} />
      <Upload className={`mx-auto size-6 ${dangKeo ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
      <div className="mt-2 text-sm font-medium">{tieuDe ?? 'Kéo thả tệp vào đây'}</div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{goiY}</div>
      {children}
    </div>
  );
}
