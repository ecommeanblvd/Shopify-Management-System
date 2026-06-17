'use client';

import { useRef, useState } from 'react';
import { Plus, Upload, Wand2, CheckCircle2, AlertTriangle, FileStack } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { parseDhlInvoiceCsv, dhlShipmentToBillLine, type DhlShipment } from '@/features/carrier-rates/ap/dhl-invoice-csv';
import type { DhlReconcileResult } from '@/features/carrier-rates/ap/dhl-reconcile-actions';
import type { BatchImportResult } from '@/features/carrier-rates/ap/bills-actions';

interface Props {
  createBillAction: (formData: FormData) => Promise<DhlReconcileResult | null>;
  /** Import hàng loạt: mỗi file CSV → 1 hoá đơn + đối soát. */
  importAction: (formData: FormData) => Promise<BatchImportResult[]>;
  /** Tiền tệ của tài khoản — để cảnh báo nếu file lệch tiền tệ. */
  accountCurrency?: string;
}

const EMPTY = { billNumber: '', amount: '', periodStart: '', periodEnd: '', issueDate: '', dueDate: '', note: '' };
const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');
const isCsv = (f: File) => /\.csv$/i.test(f.name);

/** Nút "Thêm hoá đơn" → modal upload. KÉO-THẢ hoặc chọn file:
 *  - 1 file CSV DHL → TỰ ĐIỀN tổng + BẢNG breakdown từng shipment, sửa được rồi lưu.
 *  - NHIỀU file CSV → chế độ hàng loạt: mỗi file 1 hoá đơn + tự đẩy đối soát.
 *  - 1 file PDF/ảnh → nhập tay. */
export function AddBillDialog({ createBillAction, importAction, accountCurrency }: Props) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...EMPTY });
  const [shipments, setShipments] = useState<DhlShipment[]>([]);
  const [filled, setFilled] = useState(false);
  const [manual, setManual] = useState(false); // hiện ô nhập tay (PDF/ảnh/tự gõ)
  const [warn, setWarn] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<DhlReconcileResult | null>(null);
  const [drag, setDrag] = useState(false);
  // Chế độ hàng loạt
  const [batch, setBatch] = useState<File[]>([]);
  const [batchResults, setBatchResults] = useState<BatchImportResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  function reset() {
    setV({ ...EMPTY }); setShipments([]); setFilled(false); setManual(false); setWarn(null);
    setReconcile(null); setBatch([]); setBatchResults(null); setBusy(false); setDrag(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function fillFromCsv(f: File) {
    setBatch([]); setBatchResults(null);
    try {
      const p = parseDhlInvoiceCsv(await f.text());
      if (!p) { setWarn('Không đọc được file CSV này (không đúng định dạng hoá đơn DHL).'); return; }
      setV({ billNumber: p.billNumber, amount: p.amountInclVat ? String(p.amountInclVat) : '', periodStart: p.periodStart, periodEnd: p.periodEnd, issueDate: p.issueDate, dueDate: p.dueDate, note: p.note });
      setShipments(p.shipments); setFilled(true); setManual(false);
      if (accountCurrency && p.currency && p.currency !== accountCurrency) setWarn(`File là ${p.currency} nhưng tài khoản là ${accountCurrency} — kiểm tra lại số tiền.`);
    } catch { setWarn('Lỗi đọc file.'); }
  }

  /** Xử lý danh sách file (từ input hoặc kéo-thả). */
  async function handleFiles(files: File[]) {
    setFilled(false); setWarn(null); setShipments([]); setManual(false);
    if (files.length === 0) return;

    if (files.length > 1) {
      // NHIỀU file → batch. Chỉ nhận CSV.
      const csvs = files.filter(isCsv);
      setBatch(csvs); setBatchResults(null);
      if (csvs.length < files.length) setWarn(`Bỏ qua ${files.length - csvs.length} file không phải CSV. Chế độ hàng loạt chỉ nhận CSV.`);
      return;
    }

    const f = files[0];
    // Gắn file đơn vào native input để form đính kèm khi lưu.
    try { const dt = new DataTransfer(); dt.items.add(f); if (inputRef.current) inputRef.current.files = dt.files; } catch { /* Safari cũ */ }
    if (isCsv(f)) await fillFromCsv(f);
    else setManual(true); // PDF/ảnh → nhập tay
  }

  async function runBatch() {
    setBusy(true);
    try {
      const fd = new FormData();
      batch.forEach((f) => fd.append('files', f));
      setBatchResults(await importAction(fd));
    } catch (e) { setWarn(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    handleFiles(Array.from(e.dataTransfer.files ?? []));
  }

  const grandTotal = shipments.reduce((a, s) => a + s.totalInclVat, 0);
  const batchMode = batch.length > 0;
  const okCount = batchResults?.filter((r) => r.ok).length ?? 0;
  const skipCount = batchResults?.filter((r) => !r.ok).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Plus className="size-4" /> Thêm hoá đơn
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[88vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Thêm hoá đơn carrier</DialogTitle>
        </DialogHeader>
        <form action={async (fd) => { const r = await createBillAction(fd); if (r && r.freightLines > 0) setReconcile(r); else { setOpen(false); reset(); } }} className="space-y-4">
          {/* Vùng kéo-thả / chọn file */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={`rounded-xl border border-dashed p-4 space-y-2 transition-colors ${drag ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'}`}
          >
            <Label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Upload className="size-3.5" /> Kéo-thả hoặc chọn file (CSV DHL — 1 hoặc nhiều / PDF / Excel)
            </Label>
            <Input ref={inputRef} name="file" type="file" multiple accept=".csv,.pdf,.xlsx,.xls,.png,.jpg,.jpeg"
              onChange={(e) => handleFiles(Array.from(e.target.files ?? []))} />
            {batchMode ? (
              <p className="flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-400">
                <FileStack className="size-3.5" /> {batch.length} file CSV — sẽ tạo {batch.length} hoá đơn + tự đối soát.
              </p>
            ) : filled ? (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                <Wand2 className="size-3.5" /> Đã tự điền + đọc {shipments.length} shipment từ file DHL — kiểm tra rồi lưu.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Kéo cả loạt CSV vào đây để tạo hàng loạt, hoặc 1 file để xem chi tiết trước khi lưu.
              </p>
            )}
            {warn && <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠ {warn}</p>}
            {!filled && !manual && !batchMode && (
              <button type="button" onClick={() => setManual(true)}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                hoặc nhập tay (không có file CSV)
              </button>
            )}
          </div>

          {/* ----- CHẾ ĐỘ HÀNG LOẠT ----- */}
          {batchMode && (
            <div className="space-y-3">
              {!batchResults ? (
                <>
                  <div className="rounded-lg border border-border divide-y divide-border max-h-[40vh] overflow-auto">
                    {batch.map((f, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs text-muted-foreground truncate">{f.name}</div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Mỗi file 1 hoá đơn. File trùng mã hoặc sai định dạng sẽ bị bỏ qua.</p>
                </>
              ) : (
                <>
                  <div className="text-sm"><b className="text-emerald-600 dark:text-emerald-400">{okCount} tạo mới</b> · {skipCount} bỏ qua/lỗi</div>
                  <div className="rounded-lg border border-border divide-y divide-border max-h-[48vh] overflow-auto">
                    {batchResults.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                        {r.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{r.filename}</div>
                          {r.ok ? (
                            <div className="text-muted-foreground">{r.billNumber} · {r.amount != null ? `${fmt(r.amount)} ${accountCurrency ?? ''}` : ''}{r.freight ? ` · đối soát ${r.matched}/${r.freight} cước` : ''}</div>
                          ) : (
                            <div className="text-amber-600 dark:text-amber-400">{r.message}{r.billNumber ? ` (${r.billNumber})` : ''}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ----- CHẾ ĐỘ 1 FILE: tự điền / nhập tay ----- */}
          {!batchMode && filled ? (
            /* Chế độ CSV: tự điền hết, chỉ cho sửa NGÀY. Mã/số tiền/ghi chú đọc-only (gửi ngầm). */
            <div className="space-y-3">
              <input type="hidden" name="billNumber" value={v.billNumber} />
              <input type="hidden" name="amount" value={v.amount} />
              <input type="hidden" name="note" value={v.note} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
                <span><span className="text-muted-foreground">Mã:</span> <b>{v.billNumber || '—'}</b></span>
                <span><span className="text-muted-foreground">Số tiền:</span> <b>{v.amount ? fmt(Number(v.amount)) : '—'}</b></span>
                {v.note && <span className="text-muted-foreground">· {v.note}</span>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Kỳ từ *"><Input name="periodStart" type="date" required value={v.periodStart} onChange={set('periodStart')} /></Field>
                <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required value={v.periodEnd} onChange={set('periodEnd')} /></Field>
                <Field label="Ngày xuất"><Input name="issueDate" type="date" value={v.issueDate} onChange={set('issueDate')} /></Field>
                <Field label="Hạn thanh toán"><Input name="dueDate" type="date" value={v.dueDate} onChange={set('dueDate')} /></Field>
              </div>
            </div>
          ) : !batchMode && manual ? (
            /* Chế độ nhập tay (PDF/ảnh/không file): đủ ô. */
            <div className="grid grid-cols-2 gap-4">
              <Field label="Mã hoá đơn"><Input name="billNumber" placeholder="INV-..." value={v.billNumber} onChange={set('billNumber')} /></Field>
              <Field label="Số tiền (gồm VAT) *"><Input name="amount" required inputMode="numeric" placeholder="0" value={v.amount} onChange={set('amount')} /></Field>
              <Field label="Kỳ từ *"><Input name="periodStart" type="date" required value={v.periodStart} onChange={set('periodStart')} /></Field>
              <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required value={v.periodEnd} onChange={set('periodEnd')} /></Field>
              <Field label="Ngày xuất"><Input name="issueDate" type="date" value={v.issueDate} onChange={set('issueDate')} /></Field>
              <Field label="Hạn thanh toán"><Input name="dueDate" type="date" value={v.dueDate} onChange={set('dueDate')} /></Field>
              <div className="col-span-2"><Field label="Ghi chú"><Input name="note" placeholder="—" value={v.note} onChange={set('note')} /></Field></div>
            </div>
          ) : null}

          {!batchMode && shipments.length > 0 && (
            <div className="space-y-2">
              <input type="hidden" name="linesJson" value={JSON.stringify(shipments.map(dhlShipmentToBillLine))} />
              <div className="flex items-center justify-between">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Chi tiết billed theo DHL ({shipments.length} shipment)</Label>
                <span className="text-[11px] text-muted-foreground">Tổng: <b>{fmt(grandTotal)}</b></span>
              </div>
              <div className="space-y-3 rounded-lg border border-border p-3">
                {shipments.map((s, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium">{s.orderRef || '(không ref)'}</span>
                      <span className="text-muted-foreground">· {s.shipmentNumber}</span>
                      {s.product && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{s.product}</span>}
                      {s.weightKg > 0 && <span className="text-muted-foreground">· {s.weightKg} kg</span>}
                      <span className="ml-auto font-semibold">{fmt(s.totalInclVat)}</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="font-normal py-0.5">Khoản</th>
                          <th className="font-normal text-right">Phí (net)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.charges.map((c, j) => (
                          <tr key={j} className="border-t border-border/50">
                            <td className="py-0.5">{c.name || c.code}{c.code && c.name ? ` (${c.code})` : ''}</td>
                            <td className="text-right tabular-nums">{fmt(c.charge)}</td>
                          </tr>
                        ))}
                        {s.charges.length === 0 && (
                          <tr><td colSpan={2} className="py-0.5 text-muted-foreground">(không có breakdown trong file)</td></tr>
                        )}
                        {s.charges.length > 0 && (
                          <>
                            <tr className="border-t border-border text-muted-foreground">
                              <td className="py-0.5">VAT (tổng)</td>
                              <td className="text-right tabular-nums">{fmt(s.charges.reduce((a, c) => a + c.tax, 0))}</td>
                            </tr>
                            <tr className="border-t border-border font-semibold">
                              <td className="py-0.5">Tổng (gồm VAT)</td>
                              <td className="text-right tabular-nums">{fmt(s.totalInclVat)}</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Các dòng này sẽ được lưu kèm hoá đơn (xem ở phần breakdown của bill).</p>
            </div>
          )}

          {reconcile && (
            <div className="space-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              <div className="font-medium text-emerald-700 dark:text-emerald-400">
                ✓ Đã lưu + đẩy đối soát: khớp {reconcile.matched}/{reconcile.freightLines} dòng cước
              </div>
              {reconcile.unmatched.length > 0 && (
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  Chưa khớp {reconcile.unmatched.length}: {reconcile.unmatched.map((u) => u.tracking).join(', ')} ({reconcile.unmatched[0]?.reason})
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {reconcile || batchResults ? (
              <Button type="button" size="sm" onClick={() => { setOpen(false); reset(); }}>Đóng</Button>
            ) : batchMode ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Huỷ</Button>
                <Button type="button" size="sm" disabled={busy || batch.length === 0} onClick={runBatch}>
                  {busy ? `Đang xử lý ${batch.length} file…` : `Tạo ${batch.length} hoá đơn`}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Huỷ</Button>
                {(filled || manual) && <Button type="submit" size="sm">Lưu hoá đơn</Button>}
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
