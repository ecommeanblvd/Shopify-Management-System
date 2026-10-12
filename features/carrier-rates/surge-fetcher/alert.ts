/**
 * Canh tài liệu Surge Emergency Fee của UPS — BÁO ĐỘNG, không tự áp giá.
 *
 * Vì sao chỉ báo động: tờ PDF là bản origin = US và ghi USD/lb, còn UPS Việt Nam thu VND/kg
 * với tỉ giá không suy ra được (xem đầu `./ups.ts`). Mức VND đúng thì HOÁ ĐƠN nói. Nên việc
 * của bộ này là bắt đúng một điều: **tờ tài liệu đã đổi chưa** — UPS sửa mức, hoặc sửa NGÀY
 * HIỆU LỰC (CEO lưu ý 12/10/2026: "ngày hiệu lực này có thể bị thay đổi").
 *
 * Đi đúng lối bộ canh Demand của FedEx (`../demand-fetcher/alert.ts`): ghi audit khi có thay
 * đổi, KHÔNG sửa `carrier_surcharges`. Chốt giá vẫn là việc người làm, có hoá đơn làm bằng.
 *
 * Nơi nhớ "lần trước thấy gì": cột `last_auto_source` của chính các dòng `demand_per_kg`
 * UPS — cột này sinh ra để ghi dấu vết lần tự cập nhật gần nhất. Không dựng bảng mới cho
 * một chuỗi 40 ký tự.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { extractPdfText } from '@/features/carrier-rates/import/pdf-text';
import { docSurgeUpsPdf, taiSurgeUpsPdf, UPS_SURGE_PDF_URL, type KhoanSurge } from './ups';

const UPS_CARRIER_KEY = 'ups';

export interface KetQuaSurgeUps {
  kiemLuc: Date;
  /** Không tìm thấy tài khoản UPS đang bật → bỏ qua, không phải lỗi. */
  boQua: boolean;
  dauVetCu: string | null;
  dauVetMoi: string | null;
  /** true = tờ tài liệu ĐÃ KHÁC lần kiểm trước → có người cần đọc lại. */
  doi: boolean;
  /** Lần đầu chạy (chưa có dấu vết cũ) — không phải "UPS vừa đổi". */
  lanDau: boolean;
  capNhatNgay: string | null;
  khoanLienQuanVn: KhoanSurge[];
  loi: string | null;
}

/** `docText` chỉ để test (bỏ qua phần tải + trích PDF). */
export async function kiemSurgeUps(opts: { docText?: string } = {}): Promise<KetQuaSurgeUps> {
  const kiemLuc = new Date();
  const kq: KetQuaSurgeUps = {
    kiemLuc, boQua: false, dauVetCu: null, dauVetMoi: null, doi: false, lanDau: false,
    capNhatNgay: null, khoanLienQuanVn: [], loi: null,
  };

  const [account] = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, UPS_CARRIER_KEY), eq(schema.carrierAccounts.enabled, true)));
  if (!account) { kq.boQua = true; return kq; }

  const dongSurge = await db
    .select({ id: schema.carrierSurcharges.id, lastAutoSource: schema.carrierSurcharges.lastAutoSource })
    .from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, account.id),
      eq(schema.carrierSurcharges.kind, 'demand_per_kg'),
    ));
  /* Dấu vết cũ = dấu vết GẶP NHIỀU NHẤT trên các dòng (mọi dòng được đóng cùng lúc nên
   * bình thường giống nhau; nếu ai sửa tay một dòng thì số đông vẫn đúng). */
  const dem = new Map<string, number>();
  for (const d of dongSurge) {
    const v = d.lastAutoSource;
    if (v && v.startsWith('ups-surge@')) dem.set(v, (dem.get(v) ?? 0) + 1);
  }
  kq.dauVetCu = [...dem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let text: string;
  try {
    text = opts.docText ?? await extractPdfText(await taiSurgeUpsPdf());
  } catch (e) {
    kq.loi = e instanceof Error ? e.message : String(e);
    return kq;
  }

  const doc = docSurgeUpsPdf(text);
  if (!doc) {
    // KHÔNG đọc được ≠ UPS bỏ phí surge. Nói đúng việc: tờ tài liệu đổi dạng.
    kq.loi = `docSurgeUpsPdf: không nhận ra dạng tài liệu Surge Emergency Fee ở ${UPS_SURGE_PDF_URL}`
      + ' — UPS có thể đã đổi bố cục tờ này. Mở ra đọc tay rồi sửa bộ đọc.';
    return kq;
  }

  kq.dauVetMoi = doc.dauVet;
  kq.capNhatNgay = doc.capNhatNgay;
  kq.khoanLienQuanVn = doc.khoanLienQuanVn;
  kq.lanDau = kq.dauVetCu === null;
  kq.doi = kq.dauVetCu !== null && kq.dauVetCu !== doc.dauVet;

  if (kq.doi) {
    await recordAudit({
      userId: null,
      featureKey: 'carrier-rates',
      action: 'ups_surge_doc_changed',
      target: account.id,
      requestSummary: JSON.stringify({
        dauVetCu: kq.dauVetCu, dauVetMoi: doc.dauVet, capNhatNgay: doc.capNhatNgay,
        url: UPS_SURGE_PDF_URL,
        lienQuanVn: doc.khoanLienQuanVn.map((k) => ({ tien: k.tien, donVi: k.donVi, hieuLucTu: k.hieuLucTu })),
      }),
      result: 'success',
    });
  }

  // Đóng dấu lần kiểm lên các dòng surge (kể cả khi không đổi — để biết "kiểm bao giờ").
  if (dongSurge.length > 0) {
    for (const d of dongSurge) {
      await db.update(schema.carrierSurcharges)
        .set({ lastAutoFetchedAt: kiemLuc, lastAutoSource: doc.dauVet })
        .where(eq(schema.carrierSurcharges.id, d.id));
    }
  }
  return kq;
}
