/**
 * THUẦN: dựng `data` của sự kiện `order.received` — thứ MMP dùng để TẠO đơn phía họ.
 *
 * Vì sao tách ra (CEO 30/09/2026): trước đây payload này nằm inline trong
 * `requoteShipHoOrder`, nên nó là ĐƯỜNG DUY NHẤT báo đơn sang MMP — mà đường đó chỉ chạy khi
 * người vận hành bấm nút "báo giá lại". Đơn tạo từ Lark đi thẳng ra giao hàng thì MMP KHÔNG
 * BAO GIỜ biết đơn tồn tại, và mọi sự kiện sau đó bị trả 409 vĩnh viễn.
 *
 * Đo production 30/09: 18/61 đơn nguồn Lark chưa từng báo MMP thành công (nguồn internal 0/90,
 * nguồn mmp 0/12). 8 đơn trong số đó đã bắn sự kiện khác và sinh ra toàn bộ 409 đang thấy —
 * 12.175.986đ hàng đã đi mà MMP không có hồ sơ.
 *
 * `brandSlug` là BẮT BUỘC: thiếu nó MMP trả 422.
 */
export interface DonChoOrderReceived {
  partnerBrandSlug: string;
  customerRef?: string | null;
  /** Mã shop brand tự đặt (#KLS2103). Đường Lark ghi vào đây chứ không ghi customerRef. */
  brandReference?: string | null;
  recipientName?: string | null;
  recipientCompany?: string | null;
  recipientPhone?: string | null;
  country: string;
  city?: string | null;
  province?: string | null;
  postcode?: string | null;
  address1?: string | null;
  address2?: string | null;
  houseNumber?: string | null;
  shortAddress?: string | null;
  mapsUrl?: string | null;
  weightKg?: string | number | null;
  dimLengthCm?: string | number | null;
  dimWidthCm?: string | number | null;
  dimHeightCm?: string | number | null;
  packagingType?: string | null;
  /** Giá đã báo brand. Đơn Lark chưa báo giá → null; giá về sau qua `order.reconciled`. */
  chargedVnd?: string | number | null;
}

const so = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function payloadOrderReceived(o: DonChoOrderReceived): Record<string, unknown> {
  return {
    brandSlug: o.partnerBrandSlug,
    // Mã shop: đường tạo tay ghi ở customerRef, đường Lark ghi ở brandReference. MMP hiển thị
    // nó là "Mã shop" và KHÔNG khoá theo nó (mã shop không duy nhất — MMP đo #KLS2026 ra 2 đơn).
    customerRef: o.customerRef ?? o.brandReference ?? null,
    recipient: {
      name: o.recipientName ?? null,
      company: o.recipientCompany ?? null,
      phone: o.recipientPhone ?? null,
    },
    address: {
      country: o.country,
      city: o.city ?? null,
      province: o.province ?? null,
      postcode: o.postcode ?? null,
      address1: o.address1 ?? null,
      address2: o.address2 ?? null,
      houseNumber: o.houseNumber ?? null,
      shortAddress: o.shortAddress ?? null,
      mapsUrl: o.mapsUrl ?? null,
    },
    country: o.country,
    city: o.city ?? null,
    weightKg: so(o.weightKg),
    dimLengthCm: so(o.dimLengthCm),
    dimWidthCm: so(o.dimWidthCm),
    dimHeightCm: so(o.dimHeightCm),
    packagingType: o.packagingType ?? null,
    service: 'express',
    chargedVnd: so(o.chargedVnd),
    createdVia: 'sms',
  };
}
