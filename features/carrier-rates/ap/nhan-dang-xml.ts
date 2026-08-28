/**
 * Nhận dạng một file XML hoá đơn thuộc loại nào.
 *
 * Vì sao cần: cùng đuôi .xml nhưng có ít nhất ba loại khác hẳn nhau — file tải
 * từ FedEx Billing Online, hoá đơn GTGT điện tử Việt Nam (chuẩn TT78, cả FedEx
 * Việt Nam lẫn Hợp Nhất đều phát hành), và hoá đơn DHL. Trước đây tải nhầm loại
 * chỉ nhận được câu "Không đúng định dạng hoá đơn FedEx (FBO/XML)" — không cho
 * biết file thực sự là gì nên không biết phải làm gì tiếp.
 */
export type LoaiXmlHoaDon = 'fedex_fbo' | 'hoa_don_dien_tu_vn' | 'dhl' | 'khac';

export interface KetQuaNhanDang {
  loai: LoaiXmlHoaDon;
  /** Tên thẻ gốc của file — nêu ra để người dùng gửi đúng thông tin khi báo lỗi. */
  theGoc: string | null;
}

export function nhanDangXmlHoaDon(text: string): KetQuaNhanDang {
  const theGoc = text.replace(/<\?xml[^>]*\?>/g, '').match(/<\s*([A-Za-z_][\w.:-]*)/)?.[1] ?? null;
  if (!text) return { loai: 'khac', theGoc };
  if (text.includes('<Invoice_Download>')) return { loai: 'fedex_fbo', theGoc };
  if (/<HDon\b/.test(text) && /<DLHDon\b/.test(text)) return { loai: 'hoa_don_dien_tu_vn', theGoc };
  if (/<Invoice\b/.test(text)) return { loai: 'dhl', theGoc };
  return { loai: 'khac', theGoc };
}

/** Câu giải thích cho người dùng khi file không dùng được ở chỗ đang mở. */
export function moTaLoaiXml(kq: KetQuaNhanDang): string {
  switch (kq.loai) {
    case 'fedex_fbo': return 'file tải từ FedEx Billing Online';
    case 'hoa_don_dien_tu_vn': return 'hoá đơn GTGT điện tử Việt Nam';
    case 'dhl': return 'hoá đơn DHL';
    default: return kq.theGoc ? `XML lạ (thẻ gốc <${kq.theGoc}>)` : 'không phải XML hợp lệ';
  }
}
