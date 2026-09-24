'use server';

import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { carrierRatesManifest } from '../manifest';
import { quote, type CarrierAccountSnapshot, type QuoteInput, type QuoteResult } from './quote';
import { chuanHoaDanhSachPostcode } from './remote-postcode-filter';
import { tienToTheoDoDai, type DaiMaBuuChinh } from './remote-range';
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
/** Trần số ứng viên mỗi lần đi xuống cây index. Dải trong cùng một
 *  (account, nước, bề rộng) là RỜI NHAU — script import gộp dải chồng nhau —
 *  nên dải ĐẦU TIÊN có `range_end >= mã` đã là ứng viên duy nhất. Lấy 8 là
 *  biên an toàn phòng ngày dữ liệu hãng có chồng lấn, vẫn rẻ. */
const TRAN_UNG_VIEN_DAI = 8;

/**
 * Nạp các dòng DẢI có thể chứa những mã bưu chính đang cần tra.
 *
 * Vì sao không nạp cả nước: đây đúng chỗ đã làm Supabase khoá dịch vụ (D-025).
 * Riêng Mỹ có 5.121 dòng dải; một lượt tải trang Orders quote 50 đơn × 5
 * account mà nạp cả nước thì lại về đúng vết xe cũ. Thay vào đó cắt mã thành
 * mọi TIỀN TỐ (ZIP+4 '98077-5629' → '9','98',…,'980775629') rồi với mỗi
 * (nước, bề rộng, tiền tố) đi xuống index `carrier_remote_postcodes_dai_idx`
 * đúng một lần, lấy tối đa 8 dòng. Egress vì vậy tỉ lệ với SỐ ĐƠN, không phải
 * với kích thước danh sách của hãng.
 *
 * Tài khoản không có dòng dải nào (DHL, FedEx) thì mỗi lần đi xuống cây trả về
 * rỗng ngay ở nút gốc của index bộ phận — gần như không tốn gì.
 */
async function napDai(
  carrierAccountId: string,
  nuoc: string[],
  maBuuChinh: readonly (string | null | undefined)[],
  asOf: string,
) {
  const t = schema.carrierRemotePostcodes;
  // Không biết nước → không khoanh được vùng index; bỏ qua dải thay vì quét cả
  // bảng. Mọi luồng có truyền mã bưu chính đều có truyền nước (checkout, đối
  // soát, ước lượng hàng loạt), nên nhánh này trên thực tế không chạy.
  if (nuoc.length === 0) return [];

  const tienTo = new Map<string, { doDai: number; khoa: string }>();
  for (const ma of maBuuChinh) {
    for (const p of tienToTheoDoDai(ma)) tienTo.set(`${p.doDai}:${p.khoa}`, p);
  }
  if (tienTo.size === 0) return [];

  const bo: ReturnType<typeof sql>[] = [];
  for (const n of nuoc) {
    for (const p of tienTo.values()) bo.push(sql`(${n}::text, ${p.doDai}::int, ${p.khoa}::text)`);
  }

  // Hai chi tiết dưới đây KHÔNG phải tuỳ hứng — đo 24/09/2026, cùng một truy
  // vấn, ba cách viết:
  //
  //   `id in (<subquery>)`                          2.827 ms, 1.719.765 buffer
  //   `id = any (array(<subquery>))` + lọc account     14 ms,     2.015 buffer
  //   `id = any (array(<subquery>))`, KHÔNG lọc      0,13 ms,        25 buffer
  //
  // (1) `= any (array(...))` ép Postgres chạy phần tìm dải ĐÚNG MỘT LẦN
  //     (InitPlan). Với `in (...)` nó biến thành nested-loop semi join và chạy
  //     lại phần đó cho TỪNG dòng của account — 68.711 lần.
  // (2) KHÔNG lặp lại điều kiện `carrier_account_id` ở vòng ngoài. Nó thừa
  //     (vòng trong đã lọc rồi) nhưng lại đủ hấp dẫn để planner bỏ khoá chính
  //     mà đi quét toàn bộ dòng của account rồi mới lọc id.
  //
  // COLLATE "C" viết TƯỜNG MINH: tham số truyền vào mang collation mặc định của
  // CSDL, còn cột khai COLLATE "C" (migration 0161). Không ép thì Postgres có
  // thể so theo luật ngôn ngữ — khác với `<` của JS bên `remote-range.ts`, và
  // index cũng không dùng được.
  return db.select().from(t).where(
    sql`${t.id} = any (array(
      select u.id from (values ${sql.join(bo, sql`, `)}) as c(cc, ln, k)
      cross join lateral (
        select p.id, p.range_start
        from ${t} p
        where p.carrier_account_id = ${carrierAccountId}
          and p.range_start is not null
          and p.country_code = c.cc
          and p.range_len = c.ln
          and p.range_end >= c.k collate "C"
          and p.effective_from <= ${asOf}
          and (p.effective_to is null or p.effective_to > ${asOf})
        order by p.range_end asc
        limit ${TRAN_UNG_VIEN_DAI}
      ) u
      where u.range_start <= c.k collate "C"
    ))`,
  );
}

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
    // Dòng DẢI (range_start IS NOT NULL) đi đường riêng bên dưới — ba nhánh
    // mã-chính-xác này loại chúng ra để không kéo về những dòng không bao giờ
    // khớp bằng Map.get (pattern của dòng dải là chuỗi "6441000-7999999").
    const chiMaChinhXac = isNull(t.rangeStart);
    if (!pc.goc.length) {
      // Không có mã cụ thể → như cũ: cả nước (calculator / dựng ratecard).
      return db.select().from(t).where(and(...chung));
    }
    const nhanhGoc = db.select().from(t).where(and(...chung, chiMaChinhXac, inArray(t.postcodePattern, pc.goc)));
    const nhanhRutGon = db.select().from(t).where(and(...chung, chiMaChinhXac, inArray(
      sql`upper(regexp_replace(${t.postcodePattern}, '[^A-Za-z0-9]', '', 'g'))`, pc.rutGon.length ? pc.rutGon : pc.goc)));
    const nhanhThanhPho = db.select().from(t).where(and(...chung, chiMaChinhXac, sql`${t.postcodePattern} !~ '[0-9]'`));
    const nhanhDai = napDai(carrierAccountId, nuoc, opts?.remotePostcodes ?? [], remoteAsOf);
    const [a, b, c, d] = await Promise.all([nhanhGoc, nhanhRutGon, nhanhThanhPho, nhanhDai]);
    // Gộp, bỏ trùng theo id (một dòng có thể khớp cả (a) và (b)).
    const theoId = new Map<string, (typeof a)[number]>();
    for (const r of [...a, ...b, ...c, ...d]) theoId.set(r.id, r);
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
  // Dải đi riêng: chúng không tra được bằng Map.get, và để lẫn vào bản đồ mã
  // chính xác thì khoá sẽ là chuỗi "6441000-7999999" — không bao giờ khớp.
  const remotePostcodeRanges = new Map<string, DaiMaBuuChinh[]>();
  for (const p of postcodes) {
    if (p.rangeStart !== null && p.rangeEnd !== null && p.rangeLen !== null) {
      const ds = remotePostcodeRanges.get(p.countryCode) ?? [];
      ds.push({ batDau: p.rangeStart, ketThuc: p.rangeEnd, doDai: p.rangeLen, tier: p.tier ?? null });
      remotePostcodeRanges.set(p.countryCode, ds);
      continue;
    }
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

  return { ...tinh, remotePostcodes, remotePostcodeRanges };
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
