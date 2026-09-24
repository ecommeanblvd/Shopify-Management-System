/**
 * Bộ phân tích thuần cho sheet `EAS Definitions` — file "Extended Area
 * Surcharge" của UPS (ea-surcharge-vn-vi.xlsx, 68.549 dòng dữ liệu).
 *
 * Cột: Quốc gia/Vùng lãnh thổ | Mã IATA (thật ra là ISO-2) | Thấp | Cao |
 *      Thành phố | Phụ phí Điểm đi | Phụ phí Điểm đến
 *
 * MEAN gửi hàng TỪ Việt Nam và mọi dòng Việt Nam đều ghi Điểm đi = "Không",
 * nên chỉ cột ĐIỂM ĐẾN có nghĩa; cột điểm đi bị bỏ qua hoàn toàn.
 *
 * Vì sao không bung dải ra từng mã: 68.549 dòng bung hết là 16.905.756 dòng,
 * gấp 26 lần danh sách DHL (645.567) — riêng Bồ Đào Nha có dải
 * 6441000–7999999 = 1.559.000 mã, Angola là 000000–999999. Xem `remote-range.ts`.
 *
 * Tách khỏi `scripts/` để test được mà không cần DB, giống `aramex-surcharges.ts`.
 */

/** Một dòng sẵn sàng ghi vào `carrier_remote_postcodes`. */
export interface DongEas {
  /** ISO-2. */
  nuoc: string;
  /** Nhãn tier — khoá ghép với `carrier_surcharges.tier`. */
  tier: string;
  /** Giá trị cột `postcode_pattern`: mã chính xác, TÊN THÀNH PHỐ đã chuẩn hoá,
   *  hoặc dạng đọc được "6441000-7999999" với dòng dải. */
  pattern: string;
  /** Có ba cột này = dòng DẢI; để trống = dòng mã chính xác như cũ. */
  batDau?: string;
  ketThuc?: string;
  doDai?: number;
}

export interface KetQuaEas {
  dong: DongEas[];
  canhBao: string[];
  /** Đếm theo tier, tách dạng dòng — để báo cáo sau khi nạp. */
  thongKe: Map<string, { ma: number; dai: number; thanhPho: number }>;
}

/**
 * Ghép NHÃN TIER từ tên hạng mục tiếng Việt trong file.
 *
 * Hai hạng mục đầu cố ý KHÔNG dùng tên tiếng Việt: tài khoản UPS đã có sẵn hai
 * dòng `carrier_surcharges` kind='remote_fixed' với tier 'Extended' (646.720 ₫)
 * và 'Remote' (721.450 ₫) do CEO cấu hình. Tier là KHOÁ GHÉP giữa hai bảng —
 * đặt nhãn tiếng Việt thì hai dòng giá đó không bao giờ khớp, và mọi báo giá
 * UPS vẫn thiếu phụ phí y như trước khi nạp danh sách này. Đổi nhãn ở bảng giá
 * là sửa dữ liệu CEO đã chốt nên không tự ý làm.
 *
 * Ba hạng mục còn lại CHƯA có giá; chúng giữ nguyên tên tiếng Việt trong file
 * để khi CEO gửi bảng giá UPS thì dòng phụ phí mới ghép thẳng vào, không cần
 * tra bảng quy đổi. Trang surcharges hiện băng cảnh báo cho đúng ba tier này
 * (xem `remote-tier-price.ts`).
 */
export const TIER_THEO_HANG_MUC: Record<string, string> = {
  'Phụ phí Khu vực mở rộng': 'Extended',
  'Phụ phí Vùng sâu vùng xa': 'Remote',
  'Phụ phí Khu vực Phát hàng': 'Phụ phí Khu vực Phát hàng',
  'Phụ phí Khu vực Phát hàng - Mở rộng': 'Phụ phí Khu vực Phát hàng - Mở rộng',
  'Phụ phí Vùng sâu vùng xa - Mở rộng': 'Phụ phí Vùng sâu vùng xa - Mở rộng',
};

/** Ô "không có phụ phí" trong file. */
const KHONG = 'không';

/**
 * Chuẩn hoá tên hạng mục trước khi tra bảng tier.
 *
 * BẮT BUỘC, không phải cho đẹp: file của UPS trộn cả hai dạng Unicode tiếng
 * Việt trong cùng một cột. "Phụ phí Khu vực Phát hàng" ở dạng dựng sẵn (NFC,
 * `1ef1` cho "ự"), còn "Phụ phí Khu vực mở rộng" ở dạng tổ hợp (NFD, `1b0 323`
 * cho cùng chữ ấy). Hai chuỗi hiện ra giống hệt nhau trên màn hình nhưng
 * `===` trả false, nên nếu tra thẳng thì 4/5 hạng mục lặng lẽ rơi ra ngoài —
 * đúng 62.830 trong 68.549 dòng.
 */
export function chuanHoaHangMuc(raw: unknown): string {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Bảng tra không phân biệt dạng Unicode lẫn chữ hoa/thường. */
const TIER_THEO_KHOA = new Map(
  Object.entries(TIER_THEO_HANG_MUC).map(([k, v]) => [chuanHoaHangMuc(k).toLowerCase(), v]),
);

const ISO2_RE = /^[A-Z]{2}$/;
/** Mã kiểu Anh: cụm chữ rồi cụm số ("AB37", "IV4"). Chỉ dạng này mới bung được
 *  theo số khi hai đầu dải lệch độ dài. */
const CHU_ROI_SO_RE = /^([A-Z]+)([0-9]+)$/;
/** Chặn bung nhầm một dải khổng lồ thành hàng triệu dòng. */
const TRAN_BUNG = 500;

export function chuanHoa(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Bung dải mã kiểu Anh ("IV4"–"IV11") thành từng mã.
 *
 * Vì sao phải bung riêng: hai đầu lệch độ dài nên so sánh byte sai hẳn — "IV4"
 * lớn hơn "IV11". Anh cũng là nước DUY NHẤT trong file có mã nhiều bề rộng
 * (2, 3, 4 ký tự), mà để lẫn dải 3 ký tự với dải 4 ký tự trong cùng một nước
 * thì dải ngắn sẽ nuốt cả quận khác (dải "IV4" cắt "IV40" thành "IV4"). Cả
 * nước Anh chỉ có 42 dòng nên bung ra là rẻ nhất và đúng nhất.
 *
 * Trả `null` khi không bung được (không phải dạng chữ-rồi-số, khác cụm chữ,
 * hoặc quá rộng).
 */
export function bungDaiChuSo(batDau: string, ketThuc: string): string[] | null {
  const a = CHU_ROI_SO_RE.exec(batDau);
  const b = CHU_ROI_SO_RE.exec(ketThuc);
  if (!a || !b || a[1] !== b[1]) return null;
  const tu = Number(a[2]);
  const den = Number(b[2]);
  if (!Number.isFinite(tu) || !Number.isFinite(den) || den < tu) return null;
  if (den - tu + 1 > TRAN_BUNG) return null;
  const out: string[] = [];
  for (let i = tu; i <= den; i += 1) out.push(`${a[1]}${i}`);
  return out;
}

interface DaiTho {
  nuoc: string;
  tier: string;
  batDau: string;
  ketThuc: string;
  doDai: number;
}

/**
 * Gộp các dải CHỒNG hoặc LIỀN nhau trong cùng (nước, bề rộng, tier).
 *
 * Cần vì đường nạp nhanh ở `load.ts` chỉ lấy 8 ứng viên mỗi lần đi xuống index,
 * dựa vào việc dải trong một nhóm là rời nhau. File UPS thực tế chỉ có 2 cặp
 * chồng nhau (đều cùng hạng mục), nhưng ràng buộc này phải do dữ liệu ĐÃ NẠP
 * bảo đảm chứ không phải do may mắn của lần nhập này.
 *
 * KHÔNG gộp khác tier: hai vùng giá khác nhau chồng lên nhau là mâu thuẫn dữ
 * liệu, engine tự xử bằng luật "dải hẹp hơn thắng" (`khopDai`).
 */
export function gopDai(ds: DaiTho[]): DaiTho[] {
  const nhom = new Map<string, DaiTho[]>();
  for (const d of ds) {
    const k = `${d.nuoc}|${d.doDai}|${d.tier}`;
    const g = nhom.get(k) ?? [];
    g.push(d);
    nhom.set(k, g);
  }
  const out: DaiTho[] = [];
  for (const g of nhom.values()) {
    g.sort((x, y) => (x.batDau < y.batDau ? -1 : x.batDau > y.batDau ? 1 : 0));
    let hienTai = g[0];
    for (let i = 1; i < g.length; i += 1) {
      const d = g[i];
      // Chỉ gộp khi CHỒNG nhau. Không gộp "liền kề" vì với mã bưu chính, dải
      // 10000–10099 và 10100–10199 nối nhau không có nghĩa là một vùng.
      if (d.batDau <= hienTai.ketThuc) {
        if (d.ketThuc > hienTai.ketThuc) hienTai = { ...hienTai, ketThuc: d.ketThuc };
      } else {
        out.push(hienTai);
        hienTai = d;
      }
    }
    out.push(hienTai);
  }
  return out;
}

/**
 * Phân tích các dòng dữ liệu (đã bỏ 2 dòng tiêu đề) thành dòng sẵn sàng ghi.
 *
 * `raw[i]` là một dòng sheet dạng mảng ô: [nước, ISO-2, Thấp, Cao, Thành phố,
 * phụ phí điểm đi, phụ phí điểm đến].
 */
export function phanTichEas(raw: readonly (readonly unknown[])[]): KetQuaEas {
  const canhBao: string[] = [];
  const maChinhXac = new Map<string, DongEas>();
  const daiTho: DaiTho[] = [];
  const hangMucLa = new Map<string, number>();

  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i];
    if (!r || r.length === 0) continue;
    const soDong = i + 3; // +2 dòng tiêu đề, +1 vì người đọc đếm từ 1

    const hangMuc = chuanHoaHangMuc(r[6]);
    if (!hangMuc || hangMuc.toLowerCase() === KHONG) continue;
    const tier = TIER_THEO_KHOA.get(hangMuc.toLowerCase());
    if (!tier) {
      hangMucLa.set(hangMuc, (hangMucLa.get(hangMuc) ?? 0) + 1);
      continue;
    }

    const nuoc = chuanHoa(r[1]);
    if (!ISO2_RE.test(nuoc)) {
      canhBao.push(`Dòng ${soDong}: mã nước "${String(r[1])}" không phải ISO-2 — bỏ qua`);
      continue;
    }

    const lo = chuanHoa(r[2]);
    const hi = chuanHoa(r[3]);
    const thanhPho = chuanHoa(r[4]);

    // Nước không dùng mã bưu chính (Brunei, Bahamas…): file ghi Thấp = Cao = 0
    // và điền tên thành phố. Engine khớp bằng `destinationCity` — lưu tên đã
    // chuẩn hoá HOA + [A-Z0-9], y hệt bên import FedEx ODA.
    if ((lo === '0' || lo === '') && (hi === '0' || hi === '')) {
      if (!thanhPho || thanhPho === '0') {
        canhBao.push(`Dòng ${soDong}: ${nuoc} không có mã lẫn tên thành phố — bỏ qua`);
        continue;
      }
      them(maChinhXac, canhBao, soDong, { nuoc, tier, pattern: thanhPho });
      continue;
    }

    if (lo === hi) {
      them(maChinhXac, canhBao, soDong, { nuoc, tier, pattern: lo });
      continue;
    }

    if (lo.length !== hi.length) {
      // Chỉ xảy ra với mã kiểu Anh ("IV4"–"IV11"). Bung ra từng mã.
      const bung = bungDaiChuSo(lo, hi);
      if (!bung) {
        canhBao.push(`Dòng ${soDong}: ${nuoc} dải "${lo}"–"${hi}" lệch độ dài và không bung được — bỏ qua`);
        continue;
      }
      for (const m of bung) them(maChinhXac, canhBao, soDong, { nuoc, tier, pattern: m });
      continue;
    }

    // Mã kiểu Anh cùng độ dài ("AB37"–"AB38") vẫn bung, vì nước Anh có mã
    // nhiều bề rộng: để lẫn dải 3 và 4 ký tự thì dải ngắn nuốt quận khác.
    if (CHU_ROI_SO_RE.test(lo) && CHU_ROI_SO_RE.test(hi)) {
      const bung = bungDaiChuSo(lo, hi);
      if (bung) {
        for (const m of bung) them(maChinhXac, canhBao, soDong, { nuoc, tier, pattern: m });
        continue;
      }
    }

    if (lo > hi) {
      canhBao.push(`Dòng ${soDong}: ${nuoc} dải ngược "${lo}"–"${hi}" — bỏ qua`);
      continue;
    }
    daiTho.push({ nuoc, tier, batDau: lo, ketThuc: hi, doDai: lo.length });
  }

  for (const [hm, n] of hangMucLa) {
    canhBao.push(`Hạng mục điểm đến chưa biết "${hm}" (${n} dòng) — bỏ qua, cần bổ sung TIER_THEO_HANG_MUC`);
  }

  const daiGop = gopDai(daiTho);
  const soGop = daiTho.length - daiGop.length;
  if (soGop > 0) canhBao.push(`Đã gộp ${soGop} dải chồng nhau cùng tier`);

  const dong: DongEas[] = [...maChinhXac.values()];
  for (const d of daiGop) {
    dong.push({
      nuoc: d.nuoc,
      tier: d.tier,
      pattern: `${d.batDau}-${d.ketThuc}`,
      batDau: d.batDau,
      ketThuc: d.ketThuc,
      doDai: d.doDai,
    });
  }

  const thongKe = new Map<string, { ma: number; dai: number; thanhPho: number }>();
  for (const d of dong) {
    const t = thongKe.get(d.tier) ?? { ma: 0, dai: 0, thanhPho: 0 };
    if (d.batDau) t.dai += 1;
    else if (/^[0-9]+$/.test(d.pattern)) t.ma += 1;
    else t.thanhPho += 1;
    thongKe.set(d.tier, t);
  }

  return { dong, canhBao, thongKe };
}

/** Thêm một dòng mã chính xác, chống trùng theo (nước, pattern). Trùng mà KHÁC
 *  tier là mâu thuẫn trong file nguồn — giữ dòng đầu và kêu lên. */
function them(
  bang: Map<string, DongEas>,
  canhBao: string[],
  soDong: number,
  d: DongEas,
): void {
  const k = `${d.nuoc}|${d.pattern}`;
  const cu = bang.get(k);
  if (!cu) {
    bang.set(k, d);
    return;
  }
  if (cu.tier !== d.tier) {
    canhBao.push(`Dòng ${soDong}: ${d.nuoc} "${d.pattern}" đã có tier "${cu.tier}", file ghi thêm "${d.tier}" — giữ cái đầu`);
  }
}
