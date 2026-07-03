'use client';

import { useState, useRef, useEffect } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

/** Chuẩn hoá chuỗi: bỏ dấu tiếng Việt để tìm kiếm không dấu vẫn khớp. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** THUẦN: lọc option theo query — prefix match trước, rồi substring; query rỗng → toàn bộ. */
export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = norm(query.trim().toLowerCase());
  if (!q) return options;
  const prefix: SelectOption[] = [];
  const sub: SelectOption[] = [];
  for (const o of options) {
    const l = norm(o.label.toLowerCase());
    if (l.startsWith(q)) prefix.push(o);
    else if (l.includes(q)) sub.push(o);
  }
  return [...prefix, ...sub];
}

/**
 * Combobox nhẹ (không dep): ô input lọc + list gợi ý click chọn.
 * allowFreeEntry=true → text gõ vào cũng là giá trị (city); false → chỉ nhận khi
 * click 1 option (country). Đóng khi click ra ngoài.
 */
export function SearchSelect({
  value, onChange, options, placeholder, allowFreeEntry = false, disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  allowFreeEntry?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;
  const shown = filterOptions(options, query).slice(0, 50);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <div ref={ref} className="relative">
      <input
        className="block w-full border rounded px-2 py-1 mt-1 disabled:opacity-50"
        placeholder={placeholder}
        disabled={disabled}
        value={open ? query : selectedLabel}
        onFocus={() => { if (!disabled) { setOpen(true); setQuery(''); } }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (allowFreeEntry) onChange(e.target.value);
        }}
      />
      {open && shown.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto border rounded bg-background shadow">
          {shown.map((o) => (
            <button
              type="button"
              key={o.value}
              className="block w-full text-left px-2 py-1 text-sm hover:bg-muted"
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
