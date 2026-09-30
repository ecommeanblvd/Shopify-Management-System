/**
 * Hàng đợi gửi MMP: đâu là sự kiện CÒN KẸT THẬT, và vì sao.
 *
 * Vì sao có file này (30/09/2026): outbox tích **84 sự kiện hỏng** suốt nhiều tuần mà không ai
 * biết — trong đó 2 đơn đã giao trị giá 3.127.489đ không vào được công nợ. Hàng đợi thất bại
 * không có người đọc thì bằng không có hàng đợi.
 *
 * Hai luật khi đếm, cả hai đều để cảnh báo GIỮ ĐƯỢC UY TÍN:
 *  1. BỎ bản đã bị vượt (`lyDoBoQua`): nó hỏng CÓ CHỦ Ý — gửi lại số cũ còn nguy hiểm hơn.
 *     Đếm cả nhóm này thì con số phình lên 73 và người đọc học cách phớt lờ nó.
 *  2. Mỗi đơn × mỗi loại sự kiện chỉ tính MỘT lần, lấy bản mới nhất — 8 lần thử cùng một sự
 *     kiện là một việc phải làm, không phải tám.
 */
import { lyDoBoQua, type SuKienDaGui } from './event-obsolete';

export interface SuKienKetThat {
  orderId: string;
  code: string;
  brandReference: string | null;
  event: string;
  occurredAt: Date;
  lastError: string | null;
  lastHttpStatus: number | null;
}

export interface NhomLyDo { lyDo: string; so: number; don: string[] }
export interface TomTatHangDoi { tong: number; nhom: NhomLyDo[]; cuNhat: Date | null }

/**
 * THUẦN: rút LÝ DO người đọc được từ `last_error`.
 *
 * MMP ghi lý do thật trong THÂN phản hồi, SMS nay nối vào sau mã HTTP dạng `http 422 · <lý do>`.
 * Bản ghi cũ chỉ có `http 422` — nói rõ là "không có lý do" chứ không im lặng, để người đọc
 * biết đây là bản ghi trước khi SMS bắt đầu lưu thân.
 */
export function lyDoNgan(lastError: string | null, httpStatus: number | null): string {
  const s = (lastError ?? '').trim();
  const i = s.indexOf(' · ');
  if (i >= 0) {
    const than = s.slice(i + 3).trim();
    if (than) return than;
  }
  // `last_http_status` mới có từ 19/09/2026; bản ghi cũ chỉ ghi mã vào `last_error` dạng
  // "http 409". Lấy mã từ CHÍNH chuỗi đó — nếu chỉ nhìn cột `last_http_status` thì 53 bản ghi
  // bị MMP TỪ CHỐI sẽ mang nhãn "mạng/timeout", tức đổ oan cho đường truyền.
  const ma = s.match(/^http (\d+)$/);
  if (ma) return `http ${ma[1]} — bản ghi cũ, chưa lưu lý do`;
  if (s) return s;
  return httpStatus == null ? 'không gửi tới nơi (mạng/timeout)' : `http ${httpStatus} — bản ghi cũ, chưa lưu lý do`;
}

/**
 * THUẦN: lọc ra sự kiện còn kẹt THẬT rồi gom theo lý do.
 * `daGuiTheoDon` là các sự kiện ĐÃ GỬI THÀNH CÔNG của từng đơn — dùng để loại bản đã bị vượt.
 */
export function tomTatHangDoiHong(
  ket: readonly SuKienKetThat[],
  daGuiTheoDon: ReadonlyMap<string, SuKienDaGui[]>,
): TomTatHangDoi {
  // Mỗi (đơn × loại sự kiện) giữ bản MỚI NHẤT — nhiều lần thử là một việc.
  const moiNhat = new Map<string, SuKienKetThat>();
  for (const e of ket) {
    if (lyDoBoQua(e, daGuiTheoDon.get(e.orderId) ?? []) != null) continue;
    const k = `${e.orderId}|${e.event}`;
    const cu = moiNhat.get(k);
    if (!cu || e.occurredAt > cu.occurredAt) moiNhat.set(k, e);
  }
  const theoLyDo = new Map<string, NhomLyDo>();
  let cuNhat: Date | null = null;
  for (const e of moiNhat.values()) {
    if (cuNhat == null || e.occurredAt < cuNhat) cuNhat = e.occurredAt;
    const lyDo = lyDoNgan(e.lastError, e.lastHttpStatus);
    const n = theoLyDo.get(lyDo) ?? { lyDo, so: 0, don: [] };
    n.so += 1;
    const ten = e.brandReference ?? e.code;
    if (!n.don.includes(ten)) n.don.push(ten);
    theoLyDo.set(lyDo, n);
  }
  return {
    tong: moiNhat.size,
    nhom: [...theoLyDo.values()].sort((a, b) => b.so - a.so),
    cuNhat,
  };
}
