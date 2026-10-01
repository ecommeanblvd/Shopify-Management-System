/**
 * Hình dạng phản hồi câu `DOC` của hai script SỬA cấu hình ship trên Shopify
 * (`sua-participant-services.ts`, `tat-thang-gia-tay.ts`) — CEO 01/10/2026.
 *
 * Vì sao TÁCH RIÊNG khỏi `KetQuaShippingQuery` ở `features/settings-viewer/queries.ts`: câu của
 * hai script này lấy thêm `id` ở mọi tầng và `locationGroup { id }`, vì chúng phải GHI ngược
 * bằng `deliveryProfileUpdate`. Câu dùng chung ở settings-viewer chỉ ĐỌC nên không có id.
 * Khai một kiểu cho cả hai là để một bên đọc trường bên kia không có.
 *
 * Mọi nhánh `?`: Shopify trả `null` cho nhánh không có dữ liệu. Khai "luôn có" chỉ chuyển lỗi
 * từ lúc biên dịch sang lúc chạy — và đây là script GHI lên cấu hình ship của store thật.
 */
export interface DichVuThamGiaId { name?: string | null; active?: boolean | null }

export interface MucCoId {
  id?: string | null;
  name?: string | null;
  active?: boolean | null;
  rateProvider?: {
    __typename?: string | null;
    /** Nhánh `DeliveryRateDefinition` — thang giá TAY (`tat-thang-gia-tay.ts` đọc). */
    price?: { amount?: string | null; currencyCode?: string | null } | null;
    /** Nhánh `DeliveryParticipant` — rate do carrier service trả về. */
    carrierService?: { id?: string | null; name?: string | null } | null;
    participantServices?: readonly DichVuThamGiaId[] | null;
  } | null;
}

export interface VungCoId {
  zone?: { id?: string | null; name?: string | null } | null;
  methodDefinitions?: { edges?: readonly { node?: MucCoId | null }[] | null } | null;
}

export interface NhomViTriCoId {
  locationGroup?: { id?: string | null } | null;
  locationGroupZones?: { edges?: readonly { node?: VungCoId | null }[] | null } | null;
}

export interface ProfileCoId {
  id?: string | null;
  name?: string | null;
  profileLocationGroups?: readonly NhomViTriCoId[] | null;
}

export interface KetQuaDocShip {
  deliveryProfiles?: { edges?: readonly { node?: ProfileCoId | null }[] | null } | null;
}

/** Phản hồi `deliveryProfileUpdate` — chỉ phần userErrors mà script đọc. */
export interface KetQuaUpdateShip {
  deliveryProfileUpdate?: { userErrors?: readonly { field?: unknown; message?: unknown }[] | null } | null;
}
