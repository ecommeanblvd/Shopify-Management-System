/**
 * THUẦN: dựng lại các cột của bảng Lark "WH - Inventory" từ dữ liệu bên mình.
 *
 * Mục đích là ĐỐI CHIẾU: Sổ nhập bên mình phải hiện đúng những giá trị mà Lark
 * đang hiện, để nhìn hai bên là biết khớp hay lệch ngay. Nên mọi tên lựa chọn ở
 * đây phải khớp NGUYÊN VĂN với Lark, không phải bản dịch cho đẹp.
 */
import {
  KHO_SANG_LARK, WH_ACTION_CHO_QC, WH_ACTION_TAM_NHAP, INVENTORY_TYPE_RETAIL,
  QC_CHECK_CHUA, QC_CHECK_PASS, QC_CHECK_FAILED,
} from './wh-lark-payload';

/** `qc_result` bên mình → tên lựa chọn `QC Check` bên Lark. */
export function qcCheckLark(ketQua: string): string {
  if (ketQua === 'pass') return QC_CHECK_PASS;
  if (ketQua === 'fail') return QC_CHECK_FAILED;
  return QC_CHECK_CHUA;
}

/**
 * `WH - Action` mà Lark ĐANG GIỮ cho chiếc này.
 *
 * Chưa gửi thì Lark chưa có dòng nào — trả null chứ không trả " Chờ QC ", vì
 * hiện một giá trị Lark không có là nói dối người đang đối chiếu.
 */
export function whActionLark(d: { larkRecordId: string | null; ketQuaQc: string }): string | null {
  if (!d.larkRecordId) return null;
  return d.ketQuaQc === 'pass' ? WH_ACTION_TAM_NHAP : WH_ACTION_CHO_QC;
}

/** Kho bên mình → tên kho NGUYÊN VĂN trên Lark ("GVM" → "HN | GVM"). */
export function warehouseLark(kho: string): string {
  return KHO_SANG_LARK[kho] ?? kho;
}

/**
 * Cột `Định danh` — công thức của Lark ghép 4 phần bằng `-`, BỎ phần rỗng:
 *   Order Number final · Lineitem SKU final · Inventory type · WH Unique code
 *
 * Thiếu `uniqueCode` (chưa gửi Lark nên chưa có AutoNumber) thì phần đó rỗng và
 * bị loại y như Lark làm — chuỗi ngắn hơn nhưng vẫn so sánh được phần đầu.
 */
export function dinhDanh(d: {
  maDon: string | null; sku: string | null; uniqueCode: string | null;
}): string {
  return [d.maDon, d.sku, INVENTORY_TYPE_RETAIL, d.uniqueCode]
    .map((x) => (x ?? '').trim())
    .filter((x) => x !== '')
    .join('-');
}

/**
 * Cột `Store final` — suy từ TIỀN TỐ MÃ ĐƠN, không phải từ store bên mình.
 *
 * Vì sao không map theo `stores.name`: hệ thống mình có 4 store, còn Lark có 15
 * lựa chọn `Store final`; nhiều lựa chọn (MER Request, MBLVD Off-store, #DISCN)
 * không ứng với store Shopify nào cả. Map theo store là đoán.
 *
 * Bảng dưới đo THẲNG từ 9.083 dòng Lark ngày 25/09, lấy tiền tố mã đơn đối
 * chiếu `Store final` thật: MBLVD→#MBLVD (5.796 dòng), TA→#TINH (580),
 * MIRER/MIR→#MIRER (89), MTB→#MTB (215), MCN→#MCN (113), HC→#HC (86),
 * MXHS→#MXHS (46). Tiền tố lạ trả null — thà trống còn hơn gán sai store.
 */
const STORE_THEO_TIEN_TO: Record<string, string> = {
  MBLVD: '#MBLVD', TA: '#TINH', MIRER: '#MIRER', MIR: '#MIRER',
  MTB: '#MTB', MCN: '#MCN', HC: '#HC', MXHS: '#MXHS',
  MOS: '#MOS', DISCN: '#DISCN',
};

export function storeFinalLark(maDon: string | null): string | null {
  if (!maDon) return null;
  const tien = /^#?([A-Za-z]+)/.exec(maDon.trim())?.[1];
  if (!tien) return null;
  return STORE_THEO_TIEN_TO[tien.toUpperCase()] ?? null;
}
