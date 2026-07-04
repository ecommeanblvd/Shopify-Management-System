import { MIN_MARKUP_PERCENT } from './offer-pricing';

/** THUẦN: lỗi sàn markup, null nếu hợp lệ. undefined = không đổi (update). */
export function markupFloorError(markupPercent: string | undefined): string | null {
  if (markupPercent === undefined) return null;
  const mk = Number(markupPercent);
  if (!Number.isFinite(mk)) return 'markup không hợp lệ';
  if (mk < MIN_MARKUP_PERCENT) return `Markup phải ≥ ${MIN_MARKUP_PERCENT}% để đảm bảo margin rủi ro`;
  return null;
}
