'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
  }
}

/**
 * Ô quét đứng đầu màn "Nhận & kiểm hàng" (spec §5). Luôn giữ con trỏ: máy quét cầm tay gõ
 * chuỗi rồi Enter y như bàn phím nên không cần bấm nút gì thêm. Trên điện thoại có thêm nút
 * mở camera, dùng `BarcodeDetector` của trình duyệt (Chrome Android có sẵn) — KHÔNG cài thêm
 * thư viện; máy không hỗ trợ thì nút này không hiện, kho gõ tay hoặc dùng máy quét cầm tay.
 */
export function OQuet({ onQuet }: { onQuet: (raw: string) => void }) {
  const [gia, setGia] = useState('');
  const [dangQuetCamera, setDangQuetCamera] = useState(false);
  const [loiCamera, setLoiCamera] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tính trực tiếp mỗi lần render — component này đã 'use client' và chỉ hiện nút khi trình
  // duyệt thật sự có BarcodeDetector, không cần giữ trong state.
  const hoTroCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  function dungCamera() {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setDangQuetCamera(false);
  }

  // Rời màn giữa chừng (chuyển route sau khi mở đơn) mà không dừng thì camera sáng mãi.
  useEffect(() => {
    return () => {
      if (intervalRef.current != null) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function moCamera() {
    setLoiCamera(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setDangQuetCamera(true);
    } catch {
      // Người dùng từ chối quyền camera, hoặc máy không có camera — không nổ, chỉ báo và cho gõ tay.
      setLoiCamera('Không mở được camera, gõ tay hoặc dùng máy quét');
    }
  }

  // <video> chỉ tồn tại trong DOM sau khi dangQuetCamera bật — gắn stream + bắt đầu quét ở đây.
  useEffect(() => {
    if (!dangQuetCamera) return;
    const BarcodeDetectorCtor = window.BarcodeDetector;
    if (!streamRef.current || !videoRef.current || !BarcodeDetectorCtor) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => { /* một số trình duyệt cần tương tác người dùng — bấm nút đã tính là tương tác */ });

    const detector = new BarcodeDetectorCtor({ formats: ['qr_code', 'code_128', 'ean_13'] });
    let dangDoc = false;
    const id = setInterval(() => {
      if (dangDoc || !videoRef.current) return;
      dangDoc = true;
      detector.detect(videoRef.current)
        .then((ketQua) => {
          if (ketQua.length > 0) {
            dungCamera();
            onQuet(ketQua[0].rawValue);
          }
        })
        .catch(() => { /* khung hình lỗi thoáng qua — thử lại lượt sau */ })
        .finally(() => { dangDoc = false; });
    }, 300);
    intervalRef.current = id;
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onQuet đổi tham chiếu không cần khởi động lại camera
  }, [dangQuetCamera]);

  function guiTay(v: string) {
    const trimmed = v.trim();
    if (!trimmed) return;
    onQuet(trimmed);
    setGia('');
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          value={gia}
          onChange={(e) => setGia(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            guiTay(gia);
          }}
          autoFocus
          autoComplete="off"
          placeholder="Quét mã đơn hoặc tem món…"
          className="h-11 min-w-[240px] flex-1 rounded-md border border-amber-500/50 bg-input/30 px-3 text-sm outline-none focus:border-amber-500"
        />
        {hoTroCamera && !dangQuetCamera && (
          <button
            type="button"
            onClick={moCamera}
            className="h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Quét bằng camera
          </button>
        )}
        {dangQuetCamera && (
          <button
            type="button"
            onClick={dungCamera}
            className="h-11 rounded-lg border border-red-500/50 px-4 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Dừng camera
          </button>
        )}
      </div>
      {loiCamera && <p className="text-[13px] text-red-600 dark:text-red-400">{loiCamera}</p>}
      {dangQuetCamera && (
        <video ref={videoRef} muted playsInline className="aspect-video w-full max-w-sm rounded-lg bg-black object-cover" />
      )}
    </div>
  );
}
