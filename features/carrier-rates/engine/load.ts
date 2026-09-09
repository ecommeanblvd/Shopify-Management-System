'use server';

import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { carrierRatesManifest } from '../manifest';
import { quote, type CarrierAccountSnapshot, type QuoteInput, type QuoteResult } from './quote';
import { chuanHoaDanhSachPostcode } from './remote-postcode-filter';
import { napPhanTinhSnapshot } from './snapshot-static';

/**
 * Dựng snapshot cho engine tính cước: ghép phần TĨNH (bảng giá, zone, bậc cân,
 * phụ phí — nạp qua bộ đệm 60 giây ở snapshot-static.ts) với danh sách ODA
 * đọc tươi theo từng lượt.
 *
 * Tách như vậy vì hai phần có nhịp đổi khác hẳn nhau: bảng giá vài tháng mới
 * đổi một lần, còn ODA phải lọc theo đúng mã bưu chính của đơn đang tính nên
 * mỗi lượt một khác (D-027).
 */
export async function loadAccountSnapshot(
  carrierAccountId: string,
  effectiveDate: Date = new Date(),
  opts?: {
    /** Chỉ nạp remote/ODA postcodes của 1 nước đích (ISO-2). Bảng ODA full-list
     *  2026 ~130k dòng/account — quote 1 đơn chỉ cần đúng nước của nó; bỏ trống
     *  = nạp tất cả (calculator, dựng ratecard nhiều nước). */
    remoteCountry?: string;
    /** Như remoteCountry nhưng cho NHIỀU nước (batch nhiều đơn: dashboard,
     *  đối soát). Rỗng = không lọc. Gộp cùng remoteCountry nếu truyền cả hai. */
    remoteCountries?: readonly string[];
    /** Bỏ hẳn postcode list (dựng ratecard: chỉ cần DÒNG phụ phí, không match
     *  postcode cụ thể). */
    skipRemotePostcodes?: boolean;
    /** Đã biết chính xác mã bưu chính cần tra (checkout, đối soát, quote ship
     *  hộ) → chỉ nạp đúng những dòng khớp, thay vì cả nước. Bảng ODA không có
     *  dòng nào dùng ký tự đại diện nên lọc thẳng theo mã là ĐỦ và không mất
     *  kết quả. Riêng US nạp cả nước đã là 112.589 dòng/lượt. */
    remotePostcodes?: readonly (string | null | undefined)[];
  },
): Promise<CarrierAccountSnapshot | null> {
  const tinh = await napPhanTinhSnapshot(carrierAccountId, effectiveDate);
  if (!tinh) return null;

  // date columns compare as 'YYYY-MM-DD' strings; normalise effectiveDate once.
  const remoteAsOf = effectiveDate.toISOString().slice(0, 10);

  // Remote/ODA list is year-versioned (effective_from/to), applied by the
  // shipment's effectiveDate — same windowing as rate cards. A row covers the
  // date when effective_from ≤ date AND (effective_to IS NULL OR date < effective_to).
  // Bảng ODA 1,03 triệu dòng (243 MB). Viết một WHERE với OR ba điều kiện thì Postgres quét hết dòng của các nước trong
  // danh sách rồi mới lọc (US 112k dòng → 1,4 s mỗi account, 5 account ≈ 7 s cho một lượt tải trang Orders, đo 09/09/2026).
  // Tách thành ba nhánh UNION, mỗi nhánh đúng một index (migration 0130):
  //   (a) mã gốc      → (account, country, postcode_pattern)          — index unique sẵn có;
  //   (b) mã rút gọn  → (account, country, upper(regexp_replace(…)))  — index biểu thức;
  //   (c) dòng ghi TÊN THÀNH PHỐ (không có chữ số) → index từng phần WHERE postcode_pattern !~ '[0-9]'.
  // Kết quả giống hệt bản OR cũ (cùng ba điều kiện, cùng lọc ngày hiệu lực), chỉ khác đường đi.
  const postcodes = opts?.skipRemotePostcodes ? [] : await (async () => {
    const nuoc = [...new Set([
      ...(opts?.remoteCountry ? [opts.remoteCountry] : []),
      ...(opts?.remoteCountries ?? []),
    ].map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
    const pc = chuanHoaDanhSachPostcode(opts?.remotePostcodes ?? []);
    const t = schema.carrierRemotePostcodes;
    const chung = [
      eq(t.carrierAccountId, carrierAccountId),
      ...(nuoc.length ? [inArray(t.countryCode, nuoc)] : []),
      lte(t.effectiveFrom, remoteAsOf),
      or(isNull(t.effectiveTo), gt(t.effectiveTo, remoteAsOf)),
    ];
    if (!pc.goc.length) {
      // Không có mã cụ thể → như cũ: cả nước (calculator / dựng ratecard).
      return db.select().from(t).where(and(...chung));
    }
    const nhanhGoc = db.select().from(t).where(and(...chung, inArray(t.postcodePattern, pc.goc)));
    const nhanhRutGon = db.select().from(t).where(and(...chung, inArray(
      sql`upper(regexp_replace(${t.postcodePattern}, '[^A-Za-z0-9]', '', 'g'))`, pc.rutGon.length ? pc.rutGon : pc.goc)));
    const nhanhThanhPho = db.select().from(t).where(and(...chung, sql`${t.postcodePattern} !~ '[0-9]'`));
    const [a, b, c] = await Promise.all([nhanhGoc, nhanhRutGon, nhanhThanhPho]);
    // Gộp, bỏ trùng theo id (một dòng có thể khớp cả (a) và (b)).
    const theoId = new Map<string, (typeof a)[number]>();
    for (const r of [...a, ...b, ...c]) theoId.set(r.id, r);
    return [...theoId.values()];
  })();

  // Chuông báo nạp full: 24/08 Supabase khoá dịch vụ vì egress 83GB/5GB, gần
  // như toàn bộ đến từ những chỗ gọi snapshot mà quên truyền nước đích. Ai
  // thêm luồng mới mà quên sẽ thấy ngay dòng này trong log Railway thay vì
  // phải đợi tới lúc hết quota mới truy ra.
  if (postcodes.length >= 20_000) {
    console.warn(
      `[carrier-snapshot] nạp ${postcodes.length.toLocaleString('vi-VN')} dòng ODA cho account ${carrierAccountId} — bộ lọc hiện tại quá rộng. ` +
      'Luồng chạy thường xuyên nên truyền remotePostcodes (đã biết mã bưu chính) hoặc skipRemotePostcodes (không tra postcode); ' +
      'lọc theo nước thôi vẫn nặng vì riêng US đã 112.589 dòng (D-025).',
    );
  }

  // Remote postcodes grouped by country, carrying tier alongside each pattern
  const remotePostcodes = new Map<string, Map<string, string | null>>();
  for (const p of postcodes) {
    const inner = remotePostcodes.get(p.countryCode) ?? new Map<string, string | null>();
    inner.set(p.postcodePattern, p.tier ?? null);
    // Also index the alphanumeric-stripped form so hyphen/space format
    // differences between the carrier file and Shopify input can't
    // break the O(1) match ('5000-289' ↔ '5000289'). '*' wildcard and
    // already-clean keys collapse to themselves.
    const stripped = p.postcodePattern.toUpperCase().replace(/[^A-Z0-9*]/g, '');
    if (stripped && !inner.has(stripped)) inner.set(stripped, p.tier ?? null);
    remotePostcodes.set(p.countryCode, inner);
  }

  return { ...tinh, remotePostcodes };
}

export async function runQuote(
  carrierAccountId: string,
  input: QuoteInput,
  userId: string,
): Promise<QuoteResult & { snapshotLoaded: boolean }> {
  const snap = await loadAccountSnapshot(carrierAccountId, new Date(), {
    remoteCountry: input.destinationCountry,
    remotePostcodes: [input.destinationPostcode],
  });
  if (!snap) {
    return {
      ok: false,
      code: 'no_zone',
      message: 'Carrier account not found.',
      snapshotLoaded: false,
    };
  }
  const result = quote(snap, input);

  // Log every calculator-context quote (sampling reserved for push_recalc later)
  try {
    await db.insert(schema.carrierQuoteLogs).values({
      carrierAccountId,
      destinationCountry: input.destinationCountry.trim().toUpperCase(),
      destinationPostcode: input.destinationPostcode?.trim() || null,
      weightKg: input.weightKg.toString(),
      breakdown: result.ok ? result.breakdown : { error: result.code, message: result.message },
      context: 'calculator',
      computedBy: userId,
    });
  } catch {
    // Logging failure shouldn't break the quote response.
  }

  // Coarse audit too — useful when investigating "why was this rate quoted"
  await recordAudit({
    userId,
    featureKey: carrierRatesManifest.key,
    action: 'carrier_quote',
    target: carrierAccountId,
    requestSummary: `${input.destinationCountry} ${input.weightKg}kg${input.destinationPostcode ? ' ' + input.destinationPostcode : ''}`,
    result: result.ok ? 'success' : 'error',
    errorDetail: result.ok ? null : result.message,
  });

  return { ...result, snapshotLoaded: true };
}
