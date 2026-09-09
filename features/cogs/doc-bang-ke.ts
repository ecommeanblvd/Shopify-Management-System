/**
 * THUẦN: mảng ô của mọi sheet trong workbook bảng kê brand → BangKe[] (spec §5).
 * Tìm cột theo TÊN tiêu đề, không theo vị trí — các tháng có cột thừa/thiếu.
 * Hai khuôn sheet đã gặp (08/09/2026):
 *   - Denio: tiền VND, cột "Tổng thành tiền TT", mục "A. Đơn thực nhận" / "B. Đơn return".
 *   - Happy Clothing: tiền USD ("$935.00"), cột "Thành tiền", mục "A. Đơn MEAN thực nhận" /
 *     "B. Đơn Happy Clothing Global thực nhận" (đơn #HC… trên store riêng của brand, KHÔNG phải
 *     return), dòng "TỔNG:" / "TỔNG THANH TOÁN:" quy VND → tỉ giá kỳ = VND ÷ Σ USD các dòng;
 *     mọi dòng được đổi sang VND ngay khi đọc (ttGoc giữ USD để kiểm công thức).
 */
import { docTien, docPhanTram } from './tien';

export type O = string | number | null | undefined;
export interface DongBangKe {
  ngay: string; maDon: string; tenSp: string; sku: string; sl: number;
  giaNoiDia: number | null; ck: number | null; phiCustomize: number | null; tt: number;
  code: string | null; hangSheet: number;
  /** Số tiền GỐC trên sheet khi sheet tính bằng ngoại tệ (USD); `tt` đã đổi sang VND. */
  ttGoc?: number;
  /** VND ghi sẵn trên sheet cho dòng USD (cột Note — La Vierge); nếu có thì `tt` lấy đúng số này. */
  ttVndSan?: number;
  /** Dòng VND mà cột Note = TT ÷ 1,08 → brand ghi Thành tiền GỒM VAT 8 %, Note là số trước thuế (Huelleyrose). */
  truocThue?: number;
  /** Dòng thuộc mục A (để suy tỉ giá theo dòng "TỔNG (A):"). */
  mucA?: boolean;
}
export interface BangKe {
  brand: string; period: string; tuNgay: string; denNgay: string; sheet: string;
  lines: DongBangKe[]; returns: DongBangKe[]; canhBao: string[];
  /** Đơn vị của `tt` sau khi đọc: 'VND' (mặc định) — hoặc 'USD' nếu sheet USD mà không tìm được dòng TỔNG ₫ để đổi. */
  currency?: 'VND' | 'USD';
  /** Tỉ giá VND/USD suy từ chính sheet (dòng TỔNG ₫ ÷ Σ USD) khi sheet tính USD. */
  tiGia?: number;
}

// "BẢNG KÊ CÔNG NỢ" (đa số) hoặc "BẢNG KÊ ĐƠN HÀNG CẦN THANH TOÁN" (Montsand T1–T4).
// Tên brand lấy đủ đến hết dòng — kể cả dấu "|" ("JENNY K TRAN | DIVINE" là một brand riêng trong hệ thống).
const RE_TIEU_DE = /BẢNG KÊ[^\n]*\s+Từ ngày\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+đến(?:\s+ngày)?\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+Brand:\s*([^\n]+)/i;
const chuoi = (v: O): string => (v == null ? '' : String(v)).trim();

function timTieuDe(rows: O[][]): { tu: string; den: string; brand: string } | null {
  for (const r of rows.slice(0, 15)) for (const c of r) {
    const m = RE_TIEU_DE.exec(chuoi(c));
    if (m) return { tu: m[1], den: m[2], brand: m[3].trim() };
  }
  return null;
}
function coO(rows: O[][], re: RegExp): boolean { return rows.some((r) => r.some((c) => re.test(chuoi(c)))); }
function laHangTieuDe(r: O[]): boolean { const s = r.map((c) => chuoi(c).toLowerCase()); return s.includes('mã đơn') && s.includes('sku'); }
function chiSoCot(r: O[]) {
  const s = r.map((c) => chuoi(c).toLowerCase());
  const tim = (...ten: string[]) => s.findIndex((x) => ten.some((t) => x === t));
  const timPrefix = (...ten: string[]) => s.findIndex((x) => ten.some((t) => x.startsWith(t)));
  const ngayIdx = tim('ngày nhận', 'ngày return', 'ngày trả', 'ngày báo đơn', 'ngày báo', 'ngày phát sinh trên web', 'ngày');
  return {
    ngay: ngayIdx >= 0 ? ngayIdx : 0,
    maDon: tim('mã đơn'), tenSp: tim('tên sản phẩm'), sku: tim('sku'), sl: tim('số lượng'),
    gia: tim('giá nội địa', 'giá sản phẩm', 'giá global', 'giá vnd', 'giá usd'), ck: timPrefix('% ck'), kyTT: tim('kỳ thanh toán'), custom: tim('phí customize'),
    // Denio: "Tổng thành tiền TT"; Happy Clothing: "Thành tiền".
    // Cột tiền brand trả: "Tổng thành tiền TT" (chuẩn), "Thành tiền" (HC), "Tổng tiền thanh toán" (Raffiné 2026).
    tt: timPrefix('tổng thành tiền') >= 0 ? timPrefix('tổng thành tiền') : timPrefix('tổng tiền thanh toán') >= 0 ? timPrefix('tổng tiền thanh toán') : tim('thành tiền'), code: tim('code'),
    // La Vierge: cột "Note" chứa thành tiền quy VND từng dòng ("2,717,400") — dùng thẳng khi có, chính xác hơn tỉ giá kỳ.
    note: tim('note'),
  };
}
/** dd/mm/yyyy → 'yyyy-mm'. */
export function periodTuNgay(ddmmyyyy: string): string { const [, m, y] = ddmmyyyy.split('/'); return `${y}-${m.padStart(2, '0')}`; }

/** Giá trị ₫ trên dòng có nhãn khớp `re` (ưu tiên theo thứ tự truyền vào). */
function tongVndTheoNhan(rows: O[][], ...res: RegExp[]): number | null {
  for (const re of res) for (const r of rows) {
    if (!r.some((c) => re.test(chuoi(c)))) continue;
    const o = r.find((c) => /₫|đ$/i.test(chuoi(c)));
    const v = docTien(o); if (v != null && v > 0) return v;
  }
  return null;
}
/** Giá trị ₫ trên dòng TỔNG đầu tiên nằm TRƯỚC mục B (tổng của mục A) — Linh Phùng "TỔNG ", La Vierge "TỔNG THANH TOÁN (B):" (nhãn sai). */
function tongVndMucA(rows: O[][]): number | null {
  const iB = rows.findIndex((r) => r.some((c) => /^B\.\s*Đơn/i.test(chuoi(c))));
  const pham = iB >= 0 ? rows.slice(0, iB) : rows;
  const tongA = tongVndTheoNhan(pham, /^TỔNG \(A\):?$/i);
  if (tongA != null) return tongA;
  for (const r of pham) {
    if (!r.some((c) => /^TỔNG/i.test(chuoi(c)))) continue;
    const o = r.find((c) => /₫|đ$/i.test(chuoi(c))); const v = docTien(o); if (v != null && v > 0) return v;
  }
  return null;
}

/** Giá trị ₫ trên dòng TỔNG đầu tiên nằm SAU tiêu đề mục B (tổng của mục B/return). Eegen T4: return kỳ cũ có "TỔNG 3.569.615 ₫" riêng. */
function tongVndMucB(rows: O[][]): number | null {
  const iB = rows.findIndex((r) => r.some((c) => /^B\.\s*Đơn/i.test(chuoi(c))));
  if (iB < 0) return null;
  for (const r of rows.slice(iB + 1)) {
    if (r.some((c) => /^[C-Z]\.\s*Đơn/i.test(chuoi(c)))) break;
    if (!r.some((c) => /^TỔNG/i.test(chuoi(c)))) continue;
    const o = r.find((c) => /₫|đ$/i.test(chuoi(c))); const v = docTien(o); if (v != null && v > 0) return v;
  }
  return null;
}

/**
 * Dòng brand GHI RÕ tỉ giá trên tab ("Tỷ giá Vietcombank ngày chốt công nợ (30/06/2026): 26,076 ₫" — L'Scarlett):
 * là mốc chắc nhất, đứng trên mọi mốc suy từ dòng TỔNG. Chỉ nhận nếu 15.000–40.000.
 */
export function tiGiaGhiTrenSheet(rows: O[][]): number | null {
  for (const r of rows) {
    if (!r.some((c) => /^t[ỷỉ]\s*giá/i.test(chuoi(c)))) continue;
    for (const c of r) { const v = docTien(c); if (v != null && v >= 15_000 && v <= 40_000) return v; }
  }
  return null;
}

/**
 * Tỉ giá VND/USD của một tab sheet USD, suy từ chính sheet:
 *   0) dòng "Tỷ giá …: 26,076 ₫" brand ghi rõ (tiGiaGhiTrenSheet);
 *   1) "TỔNG (A):" ₫ ÷ Σ USD mục A (Calista, Happy Clothing kỳ có dòng này) — chắc nhất vì không dính return/B;
 *   2) "TỔNG:" hoặc "TỔNG THANH TOÁN…" ₫ ÷ (Σ USD lines − Σ USD returns) — HC (B Global cộng), Denio-kiểu (A − B return).
 */
export function tiGiaTuSheet(rows: O[][], sumA: number, sumLines: number, sumReturns: number, vnd: { a: number; lines: number; returns: number } = { a: 0, lines: 0, returns: 0 }): number | null {
  // Nhiều ứng viên dòng TỔNG ₫, xét theo thứ tự ưu tiên; chỉ nhận ứng viên cho TỈ GIÁ HỢP LÝ (15.000–40.000 VND/USD).
  // Tracy Studio T6: dòng "TỔNG (A)" đầu có ₫ là số đối chiếu (83 triệu, tỉ giá 14.630 ✗) — dòng "TỔNG (A) 148.189.908 đ"
  // phía dưới mới là tổng trước thuế thật (26.076 ✓). "TỔNG THANH TOÁN" thường gồm VAT 8% → để cuối cùng.
  const ghi = tiGiaGhiTrenSheet(rows); if (ghi != null) return ghi;
  const hopLy = (r: number | null) => r != null && r >= 15_000 && r <= 40_000 ? r : null;
  const vndCua = (r: O[]) => docTien(r.find((c) => /₫|đ$/i.test(chuoi(c))));
  const theoA = (v: number | null) => (v != null && sumA > 0 && v - vnd.a > 0 ? hopLy((v - vnd.a) / sumA) : null);
  const theoKy = (v: number | null) => { const mau = sumLines - sumReturns; return v != null && mau > 0 && v - (vnd.lines - vnd.returns) > 0 ? hopLy((v - (vnd.lines - vnd.returns)) / mau) : null; };
  // 1) tổng mục A: "TỔNG (A):" / dòng TỔNG ₫ đầu trước mục B, rồi mọi dòng "TỔNG (A)" có ₫ (theo thứ tự xuất hiện).
  const ungA: number[] = []; const dauA = tongVndMucA(rows); if (dauA != null) ungA.push(dauA);
  for (const r of rows) if (r.some((c) => /^TỔNG \(A\):?$/i.test(chuoi(c)))) { const v = vndCua(r); if (v != null && v > 0) ungA.push(v); }
  for (const v of ungA) { const r = theoA(v); if (r != null) return r; }
  // 2) tổng kỳ, theo thứ tự: "TỔNG (A±B)" → "TỔNG:" (Happy Clothing: dòng quy đổi thuần, đứng TRƯỚC "TỔNG THANH TOÁN:")
  //    → "Tổng"/"TỔNG" (dòng ĐẦU tiên — dòng cuối cùng thường lặp lại TỔNG THANH TOÁN gồm VAT) → "TỔNG THANH TOÁN…" (dòng cuối).
  const coVnd = (r: O[]) => r.some((c) => /₫|đ$/i.test(chuoi(c)));
  const timDau = (re: RegExp) => rows.find((r) => r.some((c) => re.test(chuoi(c))) && coVnd(r));
  const timCuoi = (re: RegExp) => [...rows].reverse().find((r) => r.some((c) => re.test(chuoi(c))) && coVnd(r));
  for (const row of [timCuoi(/^TỔNG \(A\s*[-+]\s*B\)$/i), timDau(/^TỔNG:$/i), timDau(/^(Tổng|TỔNG)$/i), timCuoi(/^TỔNG THANH TOÁN/i)]) {
    const r = theoKy(row ? vndCua(row) : null); if (r != null) return r;
  }
  return null;
}

export function docWorkbook(sheets: Array<{ name: string; rows: O[][] }>): { bangKe: BangKe[]; boQua: string[] } {
  const bangKe: BangKe[] = []; const boQua: string[] = [];
  // Tên tab bị Google cắt ở 31 ký tự ("… T1 đơn thực nh") → so tiền tố "thực nh"/"thực b".
  const laTenNhan = (n: string) => /thực nh/i.test(n), laTenBan = (n: string) => /thực b/i.test(n);
  const noiDungBan = (rows: O[][]) => coO(rows, /A\.\s*Đơn (MEAN )?thực bán/i);
  // Kỳ đã có tab bảng kê thực nhận "thật" (tên nói rõ, hoặc tên không nói gì và nội dung không phải thực bán). Tab tên không
  // nói gì mà nội dung "A. Đơn thực bán" chỉ là tham khảo KHI kỳ đó có tab thực nhận; nếu là tab duy nhất của kỳ (TINH Atelier
  // T4–T8/2026: "File đối soát T42026", đã điền Thành tiền + TỔNG THANH TOÁN) thì chính nó là bảng kê.
  const kyCoThucNhan = new Set<string>();
  for (const sh of sheets) {
    if (/^\s*(Bản sao|Copy of)/i.test(sh.name) || laTenBan(sh.name)) continue;
    const td = timTieuDe(sh.rows); if (!td) continue;
    if (laTenNhan(sh.name) || !noiDungBan(sh.rows)) kyCoThucNhan.add(periodTuNgay(td.tu));
  }
  for (const sh of sheets) {
    // Tab "Bản sao của …"/"Copy of …" là bản nháp nhân đôi kỳ (Maison des Copains T7) → bỏ, tránh ghi hai lần một kỳ.
    if (/^\s*(Bản sao|Copy of)/i.test(sh.name)) { boQua.push(`${sh.name}: tab bản sao (bỏ)`); continue; }
    const td = timTieuDe(sh.rows);
    if (!td) { boQua.push(`${sh.name}: không có tiêu đề BẢNG KÊ … Từ ngày … Brand:`); continue; }
    // Tab thực bán: theo TÊN tab; tên không nói gì thì mới xét nội dung. Tên có "thực nhận" thì luôn là bảng kê thực nhận
    // (De Theia T1–T5 ghi nhầm tiêu đề mục "A. Đơn thực bán" trong tab thực nhận).
    const tenBan = laTenBan(sh.name), tenNhan = laTenNhan(sh.name);
    const banTheoNoiDung = !tenBan && !tenNhan && noiDungBan(sh.rows);
    if (tenBan || (banTheoNoiDung && kyCoThucNhan.has(periodTuNgay(td.tu)))) { boQua.push(`${sh.name}: tab thực bán (chỉ tham khảo)`); continue; }
    const canhBaoDau = banTheoNoiDung ? [`${sh.name}: tiêu đề mục "A. Đơn thực bán" nhưng là tab duy nhất của kỳ → đọc như bảng kê thực nhận`] : [];
    // Mục A: "A. Đơn thực nhận", "A. Đơn MEAN thực nhận", "A. Đơn phát sinh trong tháng (trước 13/02)" (Montsand)…
    const khongCoMucA = !coO(sh.rows, /^A\.\s*Đơn/i);
    // Montsand: tab "Đơn thực nhận đối soát T8" không có dòng "A. Đơn thực nhận" — bảng bắt đầu ngay sau tiêu đề → coi cả tab là mục A.
    if (khongCoMucA && !tenNhan) { boQua.push(`${sh.name}: không có mục A. Đơn thực nhận`); continue; }
    const bk: BangKe = { brand: td.brand, period: periodTuNgay(td.tu), tuNgay: td.tu, denNgay: td.den, sheet: sh.name, lines: [], returns: [], canhBao: canhBaoDau };
    let muc: 'A' | 'B' | null = khongCoMucA ? 'A' : null; let bLaReturn = false; let soDongDon = 0; let soKhongDocTT = 0; const kyTTs = new Set<number>(); let cot: ReturnType<typeof chiSoCot> | null = null; let ngayMissing = false; let coUsd = false;
    sh.rows.forEach((r, i) => {
      const dau = r.map(chuoi).find((x) => x) ?? '';
      // Tiêu đề mục "X. Đơn …": chữ cái KHÔNG quyết định cộng/trừ — có chữ return/trả/hoàn là mục TRỪ (LaLing T6 ghi
      // "A. ĐƠN RETURN TRONG THÁNG"); còn lại là mục cộng (A, hoặc B kiểu Happy Clothing Global / Whiteplan / Montsand).
      if (/^[A-Z]\.\s*Đơn/i.test(dau)) {
        const laReturn = /\bre(turn)?\b|\btrả\b|\bhoàn\b/i.test(dau);
        // GIỮ bản đồ cột của mục trước: mục sau có thể không lặp lại hàng tiêu đề (De Theia T4: "B. Đơn return" rồi dữ liệu ngay);
        // nếu mục sau có hàng tiêu đề riêng thì laHangTieuDe() phía dưới sẽ ghi đè.
        muc = laReturn ? 'B' : (/^A\./i.test(dau) ? 'A' : 'B'); bLaReturn = laReturn; return;
      }
      if (laHangTieuDe(r)) { cot = chiSoCot(r); if (cot.ngay === 0 && r.map((c) => chuoi(c).toLowerCase()).findIndex((x) => x === 'ngày nhận' || x === 'ngày return' || x === 'ngày trả' || x === 'ngày báo đơn' || x === 'ngày báo' || x === 'ngày') < 0) ngayMissing = true; return; }
      if (!muc || !cot) return;
      const maDon = chuoi(r[cot.maDon]);
      if (!maDon.startsWith('#')) return;
      soDongDon += 1;
      let ttRaw = r[cot.tt];
      let tt = docTien(typeof ttRaw === 'string' ? ttRaw.replace(/\$/g, '') : ttRaw);
      if (tt == null && cot.tt > 0) {
        // Dòng thiếu một cột (Linh Phùng mục return: không có ô "Giá phụ kiện") → dữ liệu dồn sang trái một ô:
        // ô "Tổng thành tiền" trống, số tiền nằm ở ô bên trái, còn ô Code nằm đúng chỗ TT. Nhận khi ô trái là tiền hợp lệ
        // và ô TT hiện tại KHÔNG phải tiền (là mã Code hoặc trống).
        // Chỉ khi dòng THỰC SỰ lệch: ô ở vị trí Thành tiền đang chứa mã Code ("#MBLVD…"). Nếu ô đó trống thì đây là dòng
        // brand chưa điền Thành tiền (De Theia T8) — KHÔNG lấy ô bên trái (đó là Phí customize).
        const oTT = chuoi(r[cot.tt]);
        const trai = r[cot.tt - 1]; const ttTrai = docTien(typeof trai === 'string' ? trai.replace(/\$/g, '') : trai);
        const traiKhongPhaiCustomize = cot.custom < 0 || cot.tt - 1 !== cot.custom;
        if ((oTT.startsWith('#') || traiKhongPhaiCustomize) && ttTrai != null && ttTrai > 0) { ttRaw = trai; tt = ttTrai; bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} dòng lệch cột — lấy Thành tiền ở ô bên trái (${ttTrai.toLocaleString('vi-VN')})`); }
      }
      if (tt == null) { soKhongDocTT += 1; bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} không đọc được Thành tiền`); return; }
      // Dòng USD: ô Thành tiền có '$'. Brand gõ nhầm đơn vị ("609.60 đ" — Happy Clothing T5 #MBLVD28657, Giá "$1,016.00" × 60%):
      // ô Giá có '$' mà Thành tiền < 1.000 thì không thể là VND (không có giá vốn dưới 1.000 ₫) → vẫn là USD.
      const giaRaw = cot.gia >= 0 ? r[cot.gia] : null;
      const giaUsd = typeof giaRaw === 'string' && giaRaw.includes('$');
      let laUsd = typeof ttRaw === 'string' && ttRaw.includes('$');
      if (!laUsd && giaUsd && tt < 1_000) { laUsd = true; bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} Thành tiền "${chuoi(ttRaw)}" ghi sai đơn vị — Giá là USD nên coi là ${tt} $`); }
      if (laUsd) coUsd = true;
      // VND từng dòng ghi sẵn ở cột Note (số ≥ 1.000, không có '$') — chỉ dùng cho dòng USD.
      const noteRaw = cot.note >= 0 ? r[cot.note] : null;
      const vndDong = laUsd && noteRaw != null && !String(noteRaw).includes('$') ? docTien(noteRaw) : null;
      // Chỉ tin số VND sẵn khi tỉ lệ VND/USD nằm trong dải hợp lý (15.000–40.000). La Vierge T5 ghi
      // "2,321.565" (nghìn ₫, dấu chấm là phần nghìn) → tỉ lệ 15–40 → nhân 1.000. Ngoài hai dải → bỏ.
      let ttVndSan: number | null = null;
      if (vndDong != null && tt > 0) {
        const r0 = vndDong / tt;
        if (r0 >= 15_000 && r0 <= 40_000) ttVndSan = Math.round(vndDong);
        else if (r0 >= 15 && r0 <= 40) ttVndSan = Math.round(vndDong * 1000);
      }
      // Dòng VND có Note = TT ÷ 1,08 (±0,3 %) → Thành tiền gồm VAT, Note là trước thuế (Huelleyrose 2026; CEO 09/09: giá vốn quy về trước thuế).
      const noteVnd = !laUsd && noteRaw != null ? docTien(noteRaw) : null;
      const truocThue = noteVnd != null && noteVnd > 0 && tt > 0 && Math.abs(tt / noteVnd / 1.08 - 1) <= 0.003 ? Math.round(noteVnd) : null;
      const slVal = docTien(r[cot.sl]);
      if (slVal == null || slVal <= 0) { bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} không đọc được Số lượng`); return; }
      const d: DongBangKe = {
        ngay: chuoi(r[cot.ngay]), maDon, tenSp: chuoi(r[cot.tenSp]), sku: chuoi(r[cot.sku]),
        sl: slVal, giaNoiDia: docTien(typeof r[cot.gia] === 'string' ? String(r[cot.gia]).replace(/\$/g, '') : r[cot.gia]), ck: docPhanTram(r[cot.ck]),
        phiCustomize: cot.custom >= 0 ? docTien(typeof r[cot.custom] === 'string' ? String(r[cot.custom]).replace(/\$/g, '') : r[cot.custom]) : null, tt,
        code: cot.code >= 0 ? chuoi(r[cot.code]) || null : null, hangSheet: i + 1,
        ...(laUsd ? { ttGoc: tt } : {}),
        ...(ttVndSan != null ? { ttVndSan } : {}),
        ...(truocThue != null ? { truocThue } : {}),
        ...(muc === 'A' ? { mucA: true } : {}),
      };
      (muc === 'A' || !bLaReturn ? bk.lines : bk.returns).push(d);
      if (cot.kyTT >= 0) { const k = /^T?(\d{1,2})$/i.exec(chuoi(r[cot.kyTT])); if (k) kyTTs.add(Number(k[1])); }
    });
    if (ngayMissing) bk.canhBao.push(`${sh.name}: không thấy cột Ngày, dùng cột đầu`);
    // Tiêu đề ghi sai tháng (LaLing: tab T3 mang tiêu đề 02/2026, mọi dòng ghi "Kỳ thanh toán T3") → tin cột Kỳ thanh toán
    // khi CẢ TAB đồng nhất một kỳ và kỳ đó khác tháng tiêu đề.
    if (kyTTs.size === 1) {
      const thang = [...kyTTs][0]; const period = `${bk.period.slice(0, 4)}-${String(thang).padStart(2, '0')}`;
      if (thang >= 1 && thang <= 12 && period !== bk.period) { bk.canhBao.push(`${sh.name}: tiêu đề ghi kỳ ${bk.period} nhưng mọi dòng ghi Kỳ thanh toán T${thang} → dùng ${period}`); bk.period = period; }
    }
    // Kỳ brand CHƯA điền "Tổng thành tiền" (Keira Tong T8: mọi dòng $0.00, cột % CK chép nhầm giá) → không coi là bảng kê
    // hoàn tất: bỏ toàn bộ dòng của tab, báo cảnh báo, để không ghi giá vốn 0 lên đơn.
    // … hoặc ≥ 50% dòng đơn không đọc được Thành tiền (Eegen T8: 11/12 dòng trống, 1 dòng lẻ).
    if ((bk.lines.length > 0 && bk.lines.every((d) => d.tt <= 0)) || (soDongDon >= 2 && soKhongDocTT * 2 >= soDongDon)) {
      bk.canhBao.push(`${sh.name}: ${soKhongDocTT}/${soDongDon} dòng không có Tổng thành tiền — kỳ chưa hoàn tất, KHÔNG nhập`);
      bk.lines = []; bk.returns = [];
    }
    if (coUsd) {
      // Chỉ ĐỔI các dòng USD (có ttGoc); dòng VND trong cùng tab (Linh Phùng: mục A USD, mục B VNĐ) giữ nguyên.
      const tatCa = [...bk.lines, ...bk.returns];
      const usd = tatCa.filter((d) => d.ttGoc != null);
      let coSan = usd.filter((d) => d.ttVndSan != null);
      // Thành tiền USD gồm VAT: cột VND sẵn = TỔNG ₫ ÷ 1,08 (Linh Phùng T8) → Note là trước thuế, giá vốn lấy Note; dòng thiếu Note chia 1,08.
      let ttGomVat = false; let rateSanNgoai: number | null = null;
      if (coSan.length) {
        // Kiểm TỔNG THỂ: Σ(lines) − Σ(returns) tính bằng VND sẵn (dòng USD thiếu VND sẵn thì ước theo tỉ giá suy từ
        // các dòng có sẵn) phải ≈ dòng TỔNG ₫ của sheet (số MEAN trả). Linh Phùng T8: cột Note = trước VAT (÷1,08)
        // trong khi TỔNG ₫ = USD × tỉ giá → lệch 3,4% → không tin Note, đổi theo tỉ giá TỔNG. Lệch ≤ 0,5% → tin Note.
        const sanA = coSan.filter((d) => d.mucA); const goc = sanA.length ? sanA : coSan;
        const rateSan = goc.reduce((s, d) => s + d.ttVndSan!, 0) / goc.reduce((s, d) => s + d.ttGoc!, 0); rateSanNgoai = rateSan;
        const uocVnd = (d: DongBangKe) => d.ttGoc == null ? d.tt : (d.ttVndSan ?? Math.round(d.ttGoc * rateSan));
        // Hai mốc: (i) tổng ₫ của mục A (dòng TỔNG trước mục B) so Σ A; (ii) dòng "Tổng"/"TỔNG THANH TOÁN" cuối so Σ lines − Σ returns.
        // Tin cột VND sẵn nếu khớp ≥ một mốc có sẵn; lệch cả các mốc có → bỏ.
        const tongA = tongVndMucA(sh.rows);
        const tong = [...sh.rows].reverse().find((r) => r.some((c) => /^(Tổng|TỔNG THANH TOÁN.*|TỔNG:?)$/i.test(chuoi(c))) && r.some((c) => /₫|đ$/i.test(chuoi(c))));
        const tongCuoi = tong ? docTien(tong.find((c) => /₫|đ$/i.test(chuoi(c)))) : null;
        const sumA = bk.lines.filter((d) => d.mucA).reduce((s, d) => s + uocVnd(d), 0);
        const sumAll = bk.lines.reduce((s, d) => s + uocVnd(d), 0) - bk.returns.reduce((s, d) => s + uocVnd(d), 0);
        const khop = (v: number | null, kv: number) => v != null && kv > 0 && Math.abs(kv / v - 1) <= 0.005;
        const coMoc = tongA != null || (tongCuoi != null && tongCuoi > 0);
        // Brand ghi rõ tỉ giá trên tab và cột VND sẵn đúng tỉ giá đó (≤0,5%) → TIN cột VND dù dòng TỔNG ₫ lệch
        // (L'Scarlett T5/T7: "TỔNG CÔNG NỢ MEAN THANH TOÁN" đã gồm VAT 8%, Note = TT × tỉ giá Vietcombank = trước thuế).
        const rateGhi = tiGiaGhiTrenSheet(sh.rows);
        const khopGhi = rateGhi != null && Math.abs(rateSan / rateGhi - 1) <= 0.005;
        const khopTruocThue = !khopGhi && coMoc && !khop(tongA, sumA) && !khop(tongCuoi, sumAll) && (khop(tongA, sumA * 1.08) || khop(tongCuoi, sumAll * 1.08));
        if (khopTruocThue) {
          ttGomVat = true;
          bk.canhBao.push(`${sh.name}: cột VND từng dòng = dòng TỔNG ₫ ÷ 1,08 → Thành tiền gồm VAT 8 %, giá vốn lấy số trước thuế (Note)`);
        } else if (!khopGhi && coMoc && !khop(tongA, sumA) && !khop(tongCuoi, sumAll)) {
          bk.canhBao.push(`${sh.name}: cột VND từng dòng (Σ A ${Math.round(sumA).toLocaleString('vi-VN')}) lệch dòng TỔNG ₫ (${Math.round(tongA ?? tongCuoi ?? 0).toLocaleString('vi-VN')}) — bỏ, dùng tỉ giá TỔNG`);
          for (const d of coSan) delete d.ttVndSan; coSan = [];
        }
      }
      for (const d of coSan) d.tt = d.ttVndSan!;
      const thieu = usd.filter((d) => d.ttVndSan == null);
      let rate: number | null = null;
      if (thieu.length > 0) {
        // Tỉ giá cho dòng thiếu: ƯU TIÊN dòng TỔNG ₫ của sheet (số MEAN trả; Calista T6 chỉ 1/29 dòng có Note — suy từ
        // một dòng lệch 0,03%); không có dòng TỔNG mới suy từ các dòng USD đã có VND sẵn (ưu tiên mục A, không dùng return kỳ cũ).
        {
          const sumA = bk.lines.filter((d) => d.ttGoc != null && d.mucA).reduce((s, d) => s + d.ttGoc!, 0);
          const sumLines = bk.lines.filter((d) => d.ttGoc != null).reduce((s, d) => s + d.ttGoc!, 0);
          const sumReturns = bk.returns.filter((d) => d.ttGoc != null).reduce((s, d) => s + d.ttGoc!, 0);
          rate = tiGiaTuSheet(sh.rows, sumA, sumLines, sumReturns, {
            a: bk.lines.filter((d) => d.ttGoc == null && d.mucA).reduce((s, d) => s + d.tt, 0),
            lines: bk.lines.filter((d) => d.ttGoc == null).reduce((s, d) => s + d.tt, 0),
            returns: bk.returns.filter((d) => d.ttGoc == null).reduce((s, d) => s + d.tt, 0),
          });
          if (rate == null) {
            const goc = coSan.filter((d) => d.mucA).length ? coSan.filter((d) => d.mucA) : coSan;
            const sumSanUsd = goc.reduce((s, d) => s + d.ttGoc!, 0);
            if (goc.length > 0 && sumSanUsd > 0) rate = goc.reduce((s, d) => s + d.tt, 0) / sumSanUsd;
          }
        }
        if (rate != null) for (const d of thieu) d.tt = Math.round(d.ttGoc! * rate);
        // Return kỳ cũ (tỉ giá cũ) duy nhất thiếu VND sẵn mà mục B có dòng TỔNG ₫ riêng SAU tiêu đề B → lấy đúng số brand ghi
        // (Eegen T4: 138,25 $ × 25.820 = 3.569.615 ₫, khác tỉ giá kỳ 26.108). Chỉ nhận khi tỉ giá suy ra hợp lý.
        const thieuReturn = bk.returns.filter((d) => d.ttGoc != null && d.ttVndSan == null);
        const tongB = tongVndMucB(sh.rows);
        // Nhiều dòng return kỳ cũ (Arti Apparel T8/2026: 2 dòng, tỉ giá 26.076 của kỳ 06) chia TỔNG ₫ mục B theo USD từng dòng,
        // dồn phần làm tròn vào dòng cuối để Σ return = đúng số brand.
        if (thieuReturn.length >= 1 && tongB != null) {
          const daCo = bk.returns.filter((d) => d.ttVndSan != null).reduce((s, d) => s + d.tt, 0);
          const conLai = Math.round(tongB - daCo); const sumUsd = thieuReturn.reduce((s, d) => s + d.ttGoc!, 0); const r0 = conLai / sumUsd;
          if (conLai > 0 && r0 >= 15_000 && r0 <= 40_000) {
            let daChia = 0;
            thieuReturn.forEach((d, i) => { d.tt = i === thieuReturn.length - 1 ? conLai - daChia : Math.round(d.ttGoc! * r0); daChia += d.tt; });
          }
        }
      }
      if (thieu.length === 0 || rate != null) {
        bk.currency = 'VND';
        const sumUsd = usd.reduce((s, d) => s + d.ttGoc!, 0);
        bk.tiGia = ttGomVat
          ? (rate ?? (rateSanNgoai != null ? Math.round(rateSanNgoai * 1.08 * 100) / 100 : undefined))
          : (sumUsd > 0 ? Math.round((usd.reduce((s, d) => s + d.tt, 0) / sumUsd) * 100) / 100 : undefined);
        if (ttGomVat) for (const d of thieu) d.tt = Math.round(d.tt / 1.08);
      } else { bk.currency = 'USD'; bk.canhBao.push(`${sh.name}: sheet tính USD nhưng không thấy dòng TỔNG (₫) để đổi — giữ USD`); }
    } else bk.currency = 'VND';
    // Chuẩn hoá TRƯỚC THUẾ cho dòng VND (CEO 09/09/2026): quá nửa dòng VND của tab có Note = TT ÷ 1,08 → cả tab ghi Thành tiền gồm VAT 8 %
    // → dòng có Note lấy Note, dòng còn lại chia 1,08. Brand ghi TT trước thuế + dòng "VAT 8%" riêng ở tổng không bị ảnh hưởng.
    {
      const vnd = [...bk.lines, ...bk.returns].filter((d) => d.ttGoc == null);
      const coNote = vnd.filter((d) => d.truocThue != null);
      if (coNote.length >= 1 && coNote.length * 2 >= vnd.length) {
        for (const d of vnd) d.tt = d.truocThue ?? Math.round(d.tt / 1.08);
        bk.canhBao.push(`${sh.name}: cột Note = Thành tiền ÷ 1,08 (${coNote.length}/${vnd.length} dòng) → Thành tiền gồm VAT 8 %, giá vốn quy về trước thuế`);
      }
    }
    bangKe.push(bk);
  }
  // Suy rộng trong cùng brand (CEO 09/09: giá vốn quy về trước thuế cho mọi brand): brand đã chứng minh ghi Thành tiền gồm VAT ở ≥ 1 kỳ
  // (Note = TT ÷ 1,08) thì các kỳ khác của brand cũng gồm VAT — trừ tab tự chứng minh TT trước thuế: có dòng "VAT"/"Thuế GTGT" riêng,
  // hoặc dòng TỔNG THANH TOÁN cuối = Σ TT × 1,08. Larmes chỉ ghi Note ở T4/T8, Huelleyrose không ghi Note ở T4 — giá brand không đổi theo tháng.
  const gomVat = bangKe.filter((b) => b.canhBao.some((c) => /gồm VAT/.test(c)));
  if (gomVat.length) {
    for (const bk of bangKe) {
      if (gomVat.includes(bk) || (bk.lines.length === 0 && bk.returns.length === 0)) continue;
      const sh = sheets.find((x) => x.name === bk.sheet)!;
      const coDongThue = sh.rows.some((r) => r.some((c) => /^(VAT|THUẾ|Thuế GTGT)/i.test(chuoi(c))));
      const tong = [...sh.rows].reverse().find((r) => r.some((c) => /^TỔNG THANH TOÁN/i.test(chuoi(c))) && r.some((c) => /₫|đ$/i.test(chuoi(c))));
      const tongCuoi = tong ? docTien(tong.find((c) => /₫|đ$/i.test(chuoi(c)))) : null;
      const sumKy = bk.lines.reduce((t, d) => t + d.tt, 0) - bk.returns.reduce((t, d) => t + d.tt, 0);
      const tongDaCongVat = tongCuoi != null && sumKy > 0 && Math.abs(tongCuoi / (sumKy * 1.08) - 1) <= 0.005;
      if (coDongThue || tongDaCongVat) continue;
      for (const d of [...bk.lines, ...bk.returns]) d.tt = Math.round(d.tt / 1.08);
      bk.canhBao.push(`${bk.sheet}: brand ghi Thành tiền gồm VAT 8 % ở kỳ ${gomVat.map((b) => b.period).join(', ')} → kỳ này cũng quy về trước thuế (÷ 1,08)`);
    }
  }
  return { bangKe, boQua };
}

/** TT = giá × SL × (1 − CK) + customize, sai số ≤ 1 ₫. Thiếu giá/CK → true (không kiểm được). */
export function kiemCongThuc(d: DongBangKe): boolean {
  if (d.giaNoiDia == null || d.ck == null) return true;
  // Sheet USD: kiểm trên số gốc (ttGoc); sai số 1 đơn vị tiền gốc (VND: 1đ, USD: 1$ — sheet USD làm tròn 2 chữ số).
  return Math.abs((d.ttGoc ?? d.tt) - (d.giaNoiDia * d.sl * (1 - d.ck) + (d.phiCustomize ?? 0))) <= 1;
}
