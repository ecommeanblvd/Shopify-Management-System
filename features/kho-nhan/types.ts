/**
 * Kiểu dùng chung cho luồng Nhận & Kiểm hàng.
 *
 * VÌ SAO Ở ĐÂY chứ không nằm cạnh hàm: file `'use server'` chỉ được phép export
 * HÀM ASYNC. Khai `interface` hay hằng trong đó rồi export ra là nổ lúc CHẠY
 * THẬT — `next build` KHÔNG bắt. Đã trả giá 24/09: production ném
 * `ReferenceError: DongQc is not defined`, ô tìm im lặng trả rỗng và không ai
 * biết vì sao.
 */
import type { DongThuocTinh } from './thuoc-tinh-shopify';

export interface KetQuaTim {
  lineId: string; orderId: string; storeId: string; shopifyOrderId: string;
  maDon: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  vendor: string | null; datSl: number; daNhan: number;
}

export interface DangKiem {
  id: string; unitCode: string; sku: string | null;
  /** ID biến thể Shopify ghim lúc nhận (D-106). Null khi tra không ra. */
  shopifyVariantId: string | null;
  /** record_id trên bảng Lark. Null = chưa gửi. */
  larkRecordId: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  orderId: string | null; maDon: string | null;
  storeId: string | null; shopifyOrderId: string | null;
  /** Kho của phiếu nhận — cũng là kho đã ghi sang Lark. Mặc định của ô "Nhập kho". */
  kho: string;
  taoLuc: Date;
}

export interface DongQc {
  sku: string | null;
  variantId: string | null;
  productId: string | null;
  tenSanPham: string | null;
  tenBienThe: string | null;
  /** Ảnh biến thể ĐỨNG ĐẦU (đúng màu khách đặt), rồi tới ảnh sản phẩm. */
  anh: string[];
  thuocTinh: DongThuocTinh[];
  soBiCat: number;
}

export interface DuLieuQcDon { dong: DongQc[] }

export interface ChiecLoi {
  itemId: string; unitCode: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null; maDon: string | null;
  loi: { lyDo: string; ghiChu: string | null; anhUrl: string | null }[];
}

/** Một dòng SỔ NHẬP KHO — dựng theo hình bảng Lark "WH - Inventory". */
export interface DongSoNhap {
  id: string; unitCode: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  maDon: string | null; kho: string;
  ketQuaQc: string; trangThaiTon: string | null;
  larkRecordId: string | null;
  nhanLuc: Date; qcLuc: Date | null;
}
