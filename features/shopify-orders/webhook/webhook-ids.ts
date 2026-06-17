/**
 * Webhook Shopify gửi payload REST/JSON (snake_case, `id` là SỐ), khác hẳn shape
 * GraphQL (`gid://...`) mà mapper/upsert dùng. Để khớp đúng bản ghi đã lưu (key là
 * gid), ta chuẩn hoá id của payload webhook về dạng gid.
 *
 * REST webhook luôn kèm `admin_graphql_api_id` = gid sẵn — ưu tiên dùng; fallback
 * dựng từ id số. Thuần, không I/O.
 */
export interface WebhookOrderEnvelope {
  id?: number | string;
  admin_graphql_api_id?: string;
}

const ORDER_GID = /^gid:\/\/shopify\/Order\/\d+$/;

/** gid của ĐƠN từ payload orders/* (create/updated/cancelled). */
export function webhookOrderGid(p: WebhookOrderEnvelope): string | null {
  if (p.admin_graphql_api_id && ORDER_GID.test(p.admin_graphql_api_id)) return p.admin_graphql_api_id;
  if (p.id != null && `${p.id}`.trim() !== '') return `gid://shopify/Order/${p.id}`;
  return null;
}

/** gid của ĐƠN CHA từ payload refunds/create (refund kèm order_id số). */
export function webhookRefundOrderGid(p: { order_id?: number | string }): string | null {
  if (p.order_id == null || `${p.order_id}`.trim() === '') return null;
  return `gid://shopify/Order/${p.order_id}`;
}
