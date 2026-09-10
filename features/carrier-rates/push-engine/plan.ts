/**
 * Logic thuần cho "Push Carrier Rates": dựng participant (hai mức dịch vụ hiện ở
 * checkout). Dòng flat "Standard shipping" backup từ matrix đã bỏ (D-071): Shopify
 * không có khái niệm rate dự phòng — rate flat luôn hiện cạnh rate engine và
 * chính nó là nguồn sinh lựa chọn ship trùng ở checkout.
 */

import { TEN_MUC } from '@/features/carrier-rates/hai-muc-giao';

export interface ParticipantInput {
  carrierServiceId: string;
  adaptToNewServices: boolean;
  participantServices: { name: string; active: boolean }[];
}

/**
 * Participant của zone chỉ bật ĐÚNG hai mức dịch vụ callback trả về ("Standard
 * Shipping" / "Express Shipping" — D-071). `adaptToNewServices=false` để Shopify
 * KHÔNG tự bật thêm tên lạ nếu callback lỡ trả thêm. Tên hãng không còn xuất
 * hiện ở đây: hãng làm giá gốc là việc của checkout-rates.ts.
 */
export function buildParticipant(carrierServiceId: string): ParticipantInput {
  return {
    carrierServiceId,
    adaptToNewServices: false,
    participantServices: [
      { name: TEN_MUC.standard, active: true },
      { name: TEN_MUC.express, active: true },
    ],
  };
}

export interface ZoneCountry { countryCode?: string | null; restOfWorld?: boolean | null }
/** Zone nội địa VN (free) → KHÔNG đụng. */
export function isVnZone(countries: ZoneCountry[]): boolean {
  return countries.length === 1 && countries[0]?.countryCode === 'VN' && !countries[0]?.restOfWorld;
}
