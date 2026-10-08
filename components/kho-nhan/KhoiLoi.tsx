'use client';

import { useState, useTransition } from 'react';
import { LY_DO_HOP_LE, NHAN_LY_DO, type LyDoLoi } from '@/features/kho-nhan/loi-qc';
import { qcKhongDat, themDongLoiQc } from '@/features/kho-nhan/qc-actions';
import { moRongDongLoi, kiemChoLoi } from '@/features/kho-nhan/qc-logic';
import { uploadReceiptImage } from '@/features/receiving/actions';
import { Button } from '@/components/ui/button';
import { ONhanAnh } from '@/components/ui/o-nhan-anh';

/** Một ô ảnh của một chỗ lỗi. `anhKey` null = ô còn trống (chưa chọn, hoặc đang tải). */
interface OAnhUi { key: string; anhKey: string | null; ten: string }
interface DongLoiUi { key: string; lyDo: LyDoLoi; ghiChu: string; o: OAnhUi[] }

const oMoi = (): OAnhUi => ({ key: crypto.randomUUID(), anhKey: null, ten: '' });
const dongMoi = (): DongLoiUi =>
  ({ key: crypto.randomUUID(), lyDo: 'ban', ghiChu: '', o: [oMoi()] });

/**
 * Khối nhập lỗi khi QC KHÔNG ĐẠT. Một chiếc có thể NHIỀU chỗ lỗi — bẩn gấu,
 * rách nách, hỏng khoá là ba dòng (CEO 24/09).
 *
 * Và một chỗ lỗi có thể NHIỀU ẢNH (Bảo 09/10/2026: "không thể cho nhiều ảnh vào 1 lỗi, ví dụ
 * cùng 1 lỗi bẩn nhưng nhiều chỗ"). Bản trước đúng một ô ảnh mỗi chỗ lỗi, nên muốn hai tấm cho
 * cùng vết bẩn thì phải bấm "+ Thêm chỗ lỗi" rồi chọn lại đúng lý do đó — màn hình và Lark đọc
 * ra "hai lỗi Bẩn". `moRongDongLoi` trải ra dòng lưu, bảng `wh_loi_qc` không đổi.
 *
 * Ảnh tải qua `uploadReceiptImage` sẵn có; không viết lại đường tải ảnh.
 */
/**
 * `daFail`: chiếc này ĐÃ kiểm không đạt rồi, đây là lượt BỔ SUNG bằng chứng (CEO 01/10/2026).
 * Khi đó gọi `themDongLoiQc` — chỉ thêm dòng lỗi, không đổi trạng thái, không báo Lark lần hai.
 * `qcKhongDat` sẽ từ chối ("Chiếc này đã QC rồi") và nó PHẢI từ chối, vì nó còn đổi trạng thái.
 */
export function KhoiLoi({
  itemId, coStorage, daFail = false, onXong, onHuy,
}: {
  itemId: string; coStorage: boolean; daFail?: boolean; onXong: () => void; onHuy: () => void;
}) {
  const [dong, setDong] = useState<DongLoiUi[]>([dongMoi()]);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dangTai, setDangTai] = useState<string | null>(null);

  const sua = (key: string, patch: Partial<DongLoiUi>) =>
    setDong((p) => p.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const suaO = (dKey: string, oKey: string, patch: Partial<OAnhUi>) =>
    setDong((p) => p.map((d) => (d.key !== dKey ? d
      : { ...d, o: d.o.map((o) => (o.key === oKey ? { ...o, ...patch } : o)) })));

  async function chonAnh(dKey: string, oKey: string, file: File) {
    setDangTai(oKey); setLoi(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('scope', itemId);
      const k = await uploadReceiptImage(fd);
      suaO(dKey, oKey, { anhKey: k, ten: file.name });
    } catch {
      setLoi('Tải ảnh thất bại, thử lại.');
    } finally {
      setDangTai(null);
    }
  }

  const luu = () =>
    start(async () => {
      setLoi(null);
      const cho = dong.map((d) => ({ lyDo: d.lyDo, ghiChu: d.ghiChu, anhKey: d.o.map((o) => o.anhKey) }));
      /* Kiểm trước khi gửi để câu lỗi đánh số theo CHỖ LỖI người đang thấy; máy chủ vẫn kiểm
       * lại bằng `kiemLoQc` — hàng rào, không phải nơi duy nhất. */
      const k = kiemChoLoi(cho);
      if (!k.ok) { setLoi(k.loi); return; }
      const vao = moRongDongLoi(cho);
      const r = daFail ? await themDongLoiQc(itemId, vao) : await qcKhongDat(itemId, vao);
      if (!r.ok) { setLoi(r.loi ?? 'Lưu thất bại.'); return; }
      onXong();
    });

  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{daFail ? 'Bổ sung chỗ lỗi / ảnh' : 'Chỗ lỗi'}</h3>
        <button
          type="button"
          onClick={() => setDong((p) => [...p, dongMoi()])}
          className="cursor-pointer text-sm font-medium text-primary hover:underline"
        >
          + Thêm chỗ lỗi
        </button>
      </div>

      {!coStorage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Chưa cấu hình kho ảnh nên không đính được ảnh — vẫn lưu được lý do.
        </p>
      )}

      {dong.map((d, i) => (
        <div key={d.key} className="space-y-2 rounded-md border border-border bg-background p-2">
          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Lý do {i + 1}</span>
              <select
                value={d.lyDo}
                onChange={(e) => sua(d.key, { lyDo: e.target.value as LyDoLoi })}
                aria-label={`Lý do chỗ lỗi ${i + 1}`}
                className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm"
              >
                {LY_DO_HOP_LE.map((l) => <option key={l} value={l}>{NHAN_LY_DO[l]}</option>)}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">
                Ghi chú{d.lyDo === 'khac' ? ' *' : ''}
              </span>
              <input
                value={d.ghiChu}
                onChange={(e) => sua(d.key, { ghiChu: e.target.value })}
                placeholder={d.lyDo === 'khac' ? 'Bắt buộc — ghi rõ lỗi gì' : 'Vị trí, mức độ…'}
                aria-label={`Ghi chú chỗ lỗi ${i + 1}`}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>

            {dong.length > 1 && (
              <button
                type="button"
                onClick={() => setDong((p) => p.filter((x) => x.key !== d.key))}
                aria-label={`Xoá chỗ lỗi ${i + 1}`}
                className="cursor-pointer self-end rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:mb-1"
              >
                Xoá chỗ lỗi
              </button>
            )}
          </div>

          {coStorage && (
            <div className="text-xs">
              <span className="mb-1 flex items-center gap-2 text-muted-foreground">
                Ảnh chỗ lỗi {i + 1}
                {d.o.filter((o) => o.anhKey).length > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    đã có {d.o.filter((o) => o.anhKey).length} ảnh
                  </span>
                )}
                <button
                  type="button"
                  /* Chỉ thêm ô khi mọi ô hiện tại đã có ảnh: bấm nhiều lần ra một hàng ô trống
                   * thì lượt dán tới không biết vào ô nào, mà `xuLyDan` luôn chọn ô TRỐNG ĐẦU
                   * TIÊN trên màn hình. */
                  disabled={d.o.some((o) => !o.anhKey)}
                  onClick={() => sua(d.key, { o: [...d.o, oMoi()] })}
                  className="cursor-pointer font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                >
                  + ảnh nữa
                </button>
              </span>
              <div className="flex flex-wrap gap-2">
                {d.o.map((o, j) => (
                  <div key={o.key} className="relative">
                    <ONhanAnh
                      name={`anh-loi-${i + 1}-${j + 1}`}
                      onChon={(f) => void chonAnh(d.key, o.key, f)}
                      goiY="Copy từ Zalo rồi Ctrl/Cmd+V — không cần bấm vào đâu"
                      className="w-44 cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded file:border file:border-input file:bg-background file:px-2 file:py-1"
                    />
                    {dangTai === o.key && (
                      <span className="absolute right-1 top-1 rounded bg-background/90 px-1 text-[10px] text-muted-foreground">
                        đang tải…
                      </span>
                    )}
                    {o.anhKey && (
                      <span className="absolute right-1 top-1 rounded bg-background/90 px-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                        đã tải lên
                      </span>
                    )}
                    {d.o.length > 1 && (
                      <button
                        type="button"
                        onClick={() => sua(d.key, { o: d.o.filter((x) => x.key !== o.key) })}
                        aria-label={`Bỏ ảnh ${j + 1} của chỗ lỗi ${i + 1}`}
                        className="absolute -right-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full border border-border bg-background text-xs leading-none text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {loi && <p className="text-sm text-destructive">{loi}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onHuy}>Quay lại</Button>
        <Button
          type="button" variant="destructive" size="lg"
          onClick={luu} disabled={pending || dangTai !== null}
        >
          {pending ? 'Đang lưu…' : daFail ? 'Lưu bổ sung' : 'Lưu — trả brand'}
        </Button>
      </div>
    </div>
  );
}
