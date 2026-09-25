'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { anhChatLuongCao } from '@/features/kho-nhan/anh-shopify';

/** Bề rộng đủ nét cho khung xem thường mà không kéo nguyên ảnh gốc về. */
const RONG_KHUNG = 1400;
const MUC_DAU = 3;
const MUC_MIN = 2;
const MUC_MAX = 6;

/**
 * Khung ảnh màn QC: lật ảnh và BẤM VÀO MỘT VÙNG ĐỂ PHÓNG TO vùng đó.
 *
 * CEO 25/09: "cho phép zoom ảnh ở chất lượng cao để xem kĩ hơn các chi tiết ở
 * các vùng, bằng cách click vào 1 vùng cụ thể trên ảnh".
 *
 * Cách phóng: giữ nguyên `transform: scale`, đặt `transform-origin` ĐÚNG điểm
 * vừa bấm — điểm đó đứng im còn xung quanh nở ra, nên vùng người dùng nhắm tới
 * không chạy đi đâu. Khi đã phóng thì origin bám theo con trỏ để rà quanh mà
 * không phải bấm lại từng vùng.
 *
 * Lúc phóng dùng THẲNG `anh[i]` (ảnh gốc Shopify) chứ không xin `width` — xin
 * width lúc này là tự thu nhỏ bản nét nhất mình đang có.
 *
 * KHÔNG tự thoát phóng khi chuột rời khung: việc chính của màn này là soi một
 * chi tiết rồi liếc sang cột thuộc tính bên phải để đối chiếu. Thoát mỗi lần
 * chuột đi ra là bắt người dùng bấm lại từ đầu sau từng lượt đối chiếu.
 */
export function AnhQc({ anh, ten }: { anh: string[]; ten: string }) {
  const [i, setI] = useState(0);
  /** 1 = chưa phóng. */
  const [muc, setMuc] = useState(1);
  const [diem, setDiem] = useState({ x: 50, y: 50 });
  const boc = useRef<HTMLDivElement>(null);

  const soAnh = anh.length;
  const phong = muc > 1;
  const url = anh[i]!;

  const doiAnh = useCallback((b: number) => {
    // Đổi ảnh là thoát phóng: giữ nguyên mức phóng sang ảnh khác thì người dùng
    // rơi vào một góc ngẫu nhiên của ảnh mới, không biết mình đang ở đâu.
    setMuc(1);
    setI((c) => (c + b + soAnh) % soAnh);
  }, [soAnh]);

  // Tải sẵn ảnh gốc để cú bấm phóng to hiện ra ngay, không chớp trắng.
  useEffect(() => {
    const t = new window.Image();
    t.src = url;
  }, [url]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); doiAnh(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); doiAnh(1); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [doiAnh]);

  /* Esc lúc đang phóng phải THOÁT PHÓNG, không đóng cả modal — người dùng mới
   * soi được nửa cái váy mà bay mất màn QC thì phải mở lại từ đầu. Bắt ở pha
   * capture trên window để chặn trước listener của Dialog trên document. */
  useEffect(() => {
    if (!phong) return;
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      setMuc(1);
    };
    window.addEventListener('keydown', f, true);
    return () => window.removeEventListener('keydown', f, true);
  }, [phong]);

  const viTri = (e: React.MouseEvent): { x: number; y: number } | null => {
    const r = boc.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
  };

  const bam = (e: React.MouseEvent) => {
    if (phong) { setMuc(1); return; }
    const p = viTri(e);
    if (!p) return;
    setDiem(p);
    setMuc(MUC_DAU);
  };

  const ra = (e: React.MouseEvent) => {
    if (!phong) return;
    const p = viTri(e);
    if (p) setDiem(p);
  };

  const chinhMuc = (b: number) => setMuc((m) => Math.min(MUC_MAX, Math.max(MUC_MIN, m + b)));

  return (
    <div
      ref={boc}
      onClick={bam}
      onMouseMove={ra}
      className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted ${
        phong ? 'cursor-zoom-out' : 'cursor-zoom-in'
      }`}
    >
      <div
        className="absolute inset-0"
        style={{ transform: `scale(${muc})`, transformOrigin: `${diem.x}% ${diem.y}%` }}
      >
        <Image
          key={phong ? 'goc' : 'khung'}
          src={phong ? url : anhChatLuongCao(url, RONG_KHUNG)}
          alt={`Ảnh ${i + 1}/${soAnh} của ${ten}`}
          fill
          sizes="(max-width: 768px) 100vw, 60vw"
          className="object-contain"
          unoptimized
          priority={i === 0}
        />
      </div>

      {/* Mọi nút nằm NGOÀI lớp bị scale, nếu không chúng phóng to theo ảnh. */}
      {!phong && soAnh > 1 && (
        <>
          <button
            type="button" aria-label="Ảnh trước"
            onClick={(e) => { e.stopPropagation(); doiAnh(-1); }}
            className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background/80 text-xl hover:bg-background"
          >‹</button>
          <button
            type="button" aria-label="Ảnh sau"
            onClick={(e) => { e.stopPropagation(); doiAnh(1); }}
            className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background/80 text-xl hover:bg-background"
          >›</button>
        </>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
        {soAnh > 1 && !phong && (
          <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs tabular-nums">
            {i + 1}/{soAnh}
          </span>
        )}
        {phong ? (
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-1 text-xs">
            <button
              type="button" aria-label="Bớt phóng"
              onClick={(e) => { e.stopPropagation(); chinhMuc(-1); }}
              className="grid size-7 cursor-pointer place-items-center rounded-full hover:bg-muted"
            >−</button>
            <span className="w-11 text-center tabular-nums">{muc.toFixed(1)}×</span>
            <button
              type="button" aria-label="Phóng thêm"
              onClick={(e) => { e.stopPropagation(); chinhMuc(1); }}
              className="grid size-7 cursor-pointer place-items-center rounded-full hover:bg-muted"
            >+</button>
            <span className="px-1.5 text-muted-foreground">bấm ảnh để thoát</span>
          </div>
        ) : (
          <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
            bấm vào vùng cần soi để phóng to
          </span>
        )}
      </div>
    </div>
  );
}
