'use client';
import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';

/**
 * Đọc QR bằng camera sau của điện thoại. Cùng một mã đọc liên tiếp trong 1,5s
 * chỉ báo một lần (camera bắn ~10 khung/giây). Ô nhập tay chỉ để dán/gõ MÃ khi
 * camera hỏng — không phải chỗ gõ SKU.
 */
export function MayQuet({ onMa, dangBan }: { onMa: (ma: string) => void; dangBan: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const cuoi = useRef<{ ma: string; luc: number }>({ ma: '', luc: 0 });
  const [loi, setLoi] = useState<string | null>(null);
  const [tay, setTay] = useState('');

  useEffect(() => {
    let controls: IScannerControls | undefined;
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
    if (!video.current) return;
    reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (result) => {
      if (!result) return;
      const ma = result.getText();
      const now = Date.now();
      if (ma === cuoi.current.ma && now - cuoi.current.luc < 1500) return;
      cuoi.current = { ma, luc: now };
      onMa(ma);
    }).then((c) => { controls = c; }).catch((e: unknown) => setLoi(e instanceof Error ? e.message : 'Không mở được camera'));
    return () => { controls?.stop(); };
  }, [onMa]);

  return (
    <div className="space-y-2">
      <video ref={video} className="w-full rounded-lg bg-black aspect-[4/3] object-cover" muted playsInline />
      {loi && <p className="text-sm text-red-600">Camera: {loi}. Dùng ô dưới để nhập mã.</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tay.trim()) { onMa(tay.trim()); setTay(''); } }}>
        <input value={tay} onChange={(e) => setTay(e.target.value)} placeholder="Dán mã WH-… / L:…" inputMode="text" autoCapitalize="characters"
          className="flex-1 rounded-md border border-input bg-input/30 px-3 py-2 text-base" disabled={dangBan} />
        <button type="submit" disabled={dangBan} className="rounded-md border px-3 py-2 text-sm">OK</button>
      </form>
    </div>
  );
}
