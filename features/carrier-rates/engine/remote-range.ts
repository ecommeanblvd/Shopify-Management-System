/**
 * Khớp mã bưu chính với DẢI vùng phụ phí (remote/ODA theo khoảng).
 *
 * Vì sao có file này: FedEx và DHL công bố danh sách ODA theo TỪNG MÃ nên bảng
 * `carrier_remote_postcodes` xưa nay chỉ cần `Map.get(mã)`. UPS thì không —
 * file "Extended Area Surcharge" của UPS mô tả vùng bằng KHOẢNG (Thấp–Cao):
 * 68.549 dòng, bung hết ra mã đơn lẻ là 16.905.756 dòng (gấp 26 lần danh sách
 * DHL; riêng Bồ Đào Nha có dải 6441000–7999999 = 1.559.000 mã, Angola là
 * 000000–999999). Nên phải tra theo dải.
 *
 * Đây là phần THÊM, không thay thế: engine vẫn tra mã chính xác trước, dải chỉ
 * là nước thứ hai. Tài khoản nào không có dòng dải (DHL, FedEx) thì toàn bộ
 * đường đi cũ không đổi một bước nào.
 *
 * SO SÁNH BẰNG BYTE, cố ý. Hai đầu dải được lưu đã chuẩn hoá HOA + chỉ
 * [A-Z0-9], cùng độ dài, và cột trong Postgres khai `COLLATE "C"` (migration
 * 0161). Nhờ vậy `a < b` trong JS và `a < b` trong SQL luôn cho cùng kết quả —
 * nếu để collation ngôn ngữ thì chữ và số xếp theo luật khác, đủ để một mã
 * Canada rơi ra ngoài chính dải chứa nó.
 */

/** Một dải đã nạp từ DB. */
export interface DaiMaBuuChinh {
  /** Đầu dải (bao gồm), đã chuẩn hoá. */
  batDau: string;
  /** Cuối dải (bao gồm), cùng độ dài với `batDau`. */
  ketThuc: string;
  /** Bề rộng mã của dải — mã đích bị cắt còn bấy nhiêu ký tự rồi mới so. */
  doDai: number;
  /** Nhãn tier, ghép với `carrier_surcharges.tier` khi tính phụ phí. */
  tier: string | null;
}

/** HOA + bỏ mọi ký tự không phải [A-Z0-9]. Cùng một phép với bên import. */
export function chuanHoaMa(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Mọi tiền tố của mã đã chuẩn hoá, kèm độ dài — dùng làm khoá tra dải.
 *
 * Cắt tiền tố là cách xử lý DUY NHẤT cần cho chuyện "khách nhập một kiểu, hãng
 * ghi một kiểu": ZIP+4 '98077-5629' chuẩn hoá thành '980775629', cắt còn 5 ký
 * tự ra đúng '98077' để so với dải 5 ký tự của Mỹ; mã Anh 'AB37 9XY' thành
 * 'AB379XY', cắt còn 4 ra 'AB37'. Không cần tách theo dấu ngăn cách như đường
 * mã-chính-xác, vì tiền tố đã bao trùm.
 *
 * `gioiHan` chặn số lượng khoá sinh ra (mã rác dài bất thường không làm nổ số
 * truy vấn con khi nạp snapshot).
 */
export function tienToTheoDoDai(
  postcode: string | null | undefined,
  gioiHan = 12,
): Array<{ doDai: number; khoa: string }> {
  const ma = chuanHoaMa(postcode);
  const het = Math.min(ma.length, gioiHan);
  const out: Array<{ doDai: number; khoa: string }> = [];
  for (let n = 1; n <= het; n += 1) out.push({ doDai: n, khoa: ma.slice(0, n) });
  return out;
}

/**
 * Số mã mà một dải phủ — dùng để trả lời "dải nào hẹp hơn".
 *
 * Dải toàn CHỮ SỐ (đa số các nước) đếm theo cơ số 10, vì mã ở giữa cũng toàn
 * chữ số: '1000'–'1999' là 1.000 mã chứ không phải 11.988. Dải có chữ (Canada
 * 'A0A1A0'–'A0J1V0', Anh 'AB37') đếm theo base-36, đúng bảng chữ [0-9A-Z] mà
 * thứ tự byte đang dùng để so.
 *
 * Trả `Infinity` khi dải rộng quá mức double còn giữ nguyên vẹn (36^10 ≈
 * 3,7·10^15 vẫn an toàn) — chỉ ảnh hưởng thứ tự ưu tiên, không ảnh hưởng việc
 * mã có nằm trong dải hay không.
 */
export function beRongDai(dai: DaiMaBuuChinh): number {
  if (dai.doDai > 10) return Infinity;
  const coSo = /^[0-9]+$/.test(dai.batDau) && /^[0-9]+$/.test(dai.ketThuc) ? 10 : 36;
  const dau = Number.parseInt(dai.batDau, coSo);
  const cuoi = Number.parseInt(dai.ketThuc, coSo);
  if (!Number.isFinite(dau) || !Number.isFinite(cuoi)) return Infinity;
  return cuoi - dau + 1;
}

/**
 * Tìm dải chứa `postcode`.
 *
 * LUẬT CHỌN khi một mã rơi vào NHIỀU dải (viết ra đây vì đó là câu hỏi bắt
 * buộc phải có câu trả lời cố định, không được phụ thuộc thứ tự dòng trả về từ
 * DB):
 *
 *   1. Dải HẸP HƠN thắng. Dải hẹp là mô tả cụ thể hơn về một vùng, nên nó là ý
 *      định mới/chi tiết hơn của hãng. (Mã chính xác thắng mọi dải — luật đó
 *      nằm ở `remote-match.ts`, nơi thứ tự tra được quyết định.)
 *   2. Bằng bề rộng → `batDau` nhỏ hơn thắng.
 *   3. Vẫn bằng → nhãn tier nhỏ hơn theo thứ tự chuỗi; tier NULL đứng cuối.
 *
 * Luật 2 và 3 chỉ để KẾT QUẢ TẤT ĐỊNH, không phải để mô tả dữ liệu: script
 * import đã gộp các dải chồng nhau cùng tier, và file EAS của UPS không có một
 * cặp dải chồng nhau khác tier nào (đo 23/09/2026: 0/68.549). Chúng tồn tại để
 * ngày nào hãng công bố dữ liệu chồng chéo thì engine không đổi giá theo tâm
 * trạng của planner Postgres.
 */
export function khopDai(
  dsDai: readonly DaiMaBuuChinh[] | undefined,
  postcode: string | null | undefined,
): DaiMaBuuChinh | null {
  if (!dsDai || dsDai.length === 0) return null;
  const ma = chuanHoaMa(postcode);
  if (!ma) return null;

  let totNhat: DaiMaBuuChinh | null = null;
  let beRongTot = Infinity;
  for (const dai of dsDai) {
    if (ma.length < dai.doDai) continue;
    const khoa = ma.slice(0, dai.doDai);
    if (khoa < dai.batDau || khoa > dai.ketThuc) continue;

    if (totNhat === null) {
      totNhat = dai;
      beRongTot = beRongDai(dai);
      continue;
    }
    const beRong = beRongDai(dai);
    if (beRong < beRongTot
      || (beRong === beRongTot && dai.batDau < totNhat.batDau)
      || (beRong === beRongTot && dai.batDau === totNhat.batDau
        && (totNhat.tier === null ? dai.tier !== null : dai.tier !== null && dai.tier < totNhat.tier))) {
      totNhat = dai;
      beRongTot = beRong;
    }
  }
  return totNhat;
}
