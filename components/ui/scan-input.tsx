'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
  }
}

/**
 * Ô quét dùng chung: máy quét cầm tay gõ chuỗi rồi Enter y như bàn phím, không
 * cần bấm nút gì thêm; trên điện thoại có thêm nút mở camera, dùng
 * `BarcodeDetector` của trình duyệt (Chrome Android có sẵn) — KHÔNG cài thêm
 * thư viện, máy không hỗ trợ thì nút này không hiện.
 *
 * Rút từ `components/kho-nhan/OQuet.tsx` (màn "Nhận & kiểm hàng") thành mảnh
 * dùng chung KHÔNG phụ thuộc nghiệp vụ kho — nơi gọi tự lo việc diễn giải
 * chuỗi quét ra (SKU/mã tem/biến thể/...). `components/kho-nhan/OQuet.tsx`
 * chủ ý KHÔNG bị sửa lại để dùng mảnh này (ngoài phạm vi luồng KOL) — hai nơi
 * hiện trùng logic camera/hydration, chấp nhận được vì bản gốc là code đã có
 * sẵn và ổn định.
 */
export function ScanInput({
  onQuet, placeholder = 'Quét mã hoặc gõ tay rồi Enter…', autoFocus = true, id,
}: {
  onQuet: (raw: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
}) {
  const [gia, setGia] = useState('');
  const [dangQuetCamera, setDangQuetCamera] = useState(false);
  const [loiCamera, setLoiCamera] = useState<string | null>(null);
  // App Router vẫn server-render component 'use client' này cho HTML ban đầu — server
  // KHÔNG có `window` nên luôn coi như không hỗ trợ, còn trình duyệt lúc hydrate THÌ CÓ
  // thể có BarcodeDetector, khiến nút "Quét bằng camera" biến mất/xuất hiện giữa hai lần
  // render (lệch HÌNH DẠNG cây, không phải lệch giá trị) — nên bắt đầu `false` (khớp HTML
  // server render), rồi bật lại SAU khi đã gắn xong vào DOM, trong effect. Xem giải thích
  // đầy đủ ở `components/kho-nhan/OQuet.tsx` (review 23/09/2026 Important 3) — cùng kỹ thuật.
  const [hoTroCamera, setHoTroCamera] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- phát hiện BarcodeDetector chỉ có sau khi mount, không tính được lúc render để tránh lệch hydrate
    setHoTroCamera(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function dungCamera() {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setDangQuetCamera(false);
  }

  // Rời màn/đóng dialog giữa chừng mà không dừng thì camera sáng mãi.
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
    const timerId = setInterval(() => {
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
    intervalRef.current = timerId;
    return () => clearInterval(timerId);
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
          id={id}
          value={gia}
          onChange={(e) => setGia(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            guiTay(gia);
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={placeholder}
          className="h-9 min-w-[200px] flex-1 rounded-md border border-amber-500/50 bg-input/30 px-3 text-sm outline-none focus:border-amber-500"
        />
        {hoTroCamera && !dangQuetCamera && (
          <button
            type="button"
            onClick={moCamera}
            className="h-9 cursor-pointer rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            Quét bằng camera
          </button>
        )}
        {dangQuetCamera && (
          <button
            type="button"
            onClick={dungCamera}
            className="h-9 cursor-pointer rounded-lg border border-red-500/50 px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
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
