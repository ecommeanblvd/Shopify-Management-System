'use client';
import { MaQR } from './MaQR';

export interface Tem { qr: string; chu: string; phu?: string }

/**
 * Lưới tem in qua trình duyệt. '50x30' = mỗi tem một trang 50×30mm (máy in
 * nhiệt); 'a4' = 24 tem/trang (3 cột × 8 hàng, ô 70×37mm) cho máy in văn phòng.
 * Style nhúng tại chỗ để @page chỉ áp cho trang này.
 */
export function TemGrid({ tems, kho }: { tems: Tem[]; kho: '50x30' | 'a4' }) {
  const css = kho === 'a4'
    ? `@page { size: A4 portrait; margin: 0; }
       .tem-grid { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm; justify-content: center; padding: 0; }
       .tem { width: 70mm; height: 37mm; padding: 3mm; box-sizing: border-box; page-break-inside: avoid; }`
    : `@page { size: 50mm 30mm; margin: 0; }
       .tem-grid { display: block; }
       .tem { width: 50mm; height: 30mm; padding: 2mm; box-sizing: border-box; page-break-after: always; }
       /* tem cuối không đẩy thêm trang trắng */
       .tem:last-child { page-break-after: auto; }`;
  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } } ${css}
        .tem { display: flex; gap: 2mm; align-items: center; overflow: hidden; border: 0.2mm dashed #bbb; }
        .tem canvas { width: 24mm !important; height: 24mm !important; flex: none; }
        .tem .chu { font: 600 9pt/1.2 system-ui, sans-serif; word-break: break-word; }
        .tem .phu { font: 400 7.5pt/1.2 ui-monospace, monospace; color: #444; margin-top: 1mm; }`}</style>
      <div className="no-print flex items-center gap-3 p-3">
        <button type="button" onClick={() => window.print()} className="rounded-md bg-black px-4 py-2 text-sm text-white">In {tems.length} tem</button>
        <span className="text-sm text-muted-foreground">Khổ {kho === 'a4' ? 'A4 · 24 tem/trang' : '50×30mm · máy in nhiệt'}</span>
      </div>
      <div className="tem-grid">
        {tems.map((t) => (
          <div key={t.qr} className="tem">
            <MaQR value={t.qr} size={240} />
            <div>
              <div className="chu">{t.chu}</div>
              {t.phu && <div className="phu">{t.phu}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
