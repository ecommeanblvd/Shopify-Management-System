'use client';
import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/** Vẽ QR lên canvas phía client — trang in không gọi API (spec §4). */
export function MaQR({ value, size = 96 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, value, { width: size, margin: 0, errorCorrectionLevel: 'M' });
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} aria-label={value} />;
}
