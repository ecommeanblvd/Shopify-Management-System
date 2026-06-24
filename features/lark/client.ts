/**
 * Lark Suite Bitable API client (read-only). Token cache trong RAM.
 * Endpoint + auth: open.larksuite.com (Bitable v1). Throw khi code !== 0.
 */
const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`[lark] thiếu env ${k}`);
  return v;
}

/** Table ID bảng logistics. Tên biến mới LARK_LOG_TABLE_ID (phân biệt với
 *  LARK_QC_TABLE_ID); fallback LARK_TABLE_ID cũ để không downtime khi đổi env. */
function logTableId(): string {
  const v = process.env.LARK_LOG_TABLE_ID ?? process.env.LARK_TABLE_ID;
  if (!v) throw new Error('[lark] thiếu env LARK_LOG_TABLE_ID');
  return v;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const res = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env('LARK_APP_ID'), app_secret: env('LARK_APP_SECRET') }),
  });
  const j = (await res.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number };
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`[lark] token fail: code=${j.code} msg=${j.msg}`);
  cachedToken = { token: j.tenant_access_token, expiresAt: now + (j.expire ?? 7200) * 1000 };
  return cachedToken.token;
}

export interface LarkRecord { record_id: string; fields: Record<string, unknown>; }

/** Đọc TẤT CẢ record của bảng (phân trang page_token, 500/lần). */
export async function listAllRecords(): Promise<LarkRecord[]> {
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const tableId = logTableId();
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as {
      code: number; msg: string;
      data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] list fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}

/** Body cho records/search filter theo "Order Number". Khớp CẢ dạng có '#' và
 *  không '#' (Shopify lưu '#MBLVD..' hoặc 'TA..'; Lark có thể khác) → conjunction
 *  'or' hai điều kiện. THUẦN để unit-test. */
export function buildOrderNumberSearchBody(orderNumber: string): Record<string, unknown> {
  const bare = orderNumber.replace(/^#/, '');
  const forms = [bare, `#${bare}`];
  return {
    filter: {
      conjunction: 'or',
      conditions: forms.map((v) => ({ field_name: 'Order Number', operator: 'is', value: [v] })),
    },
    automatic_fields: false,
    page_size: 500,
  };
}

/** Tìm record Lark theo Order Number (cả 2 dạng #). Read-only. Phân trang. */
export async function searchRecordsByOrderNumber(orderNumber: string): Promise<LarkRecord[]> {
  if (!orderNumber.trim()) return [];
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const tableId = logTableId();
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`);
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOrderNumberSearchBody(orderNumber)),
    });
    const j = (await res.json()) as {
      code: number; msg: string;
      data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] search fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}

/** Đọc TẤT CẢ record của QC table (env LARK_QC_TABLE_ID). Trả [] nếu chưa cấu
 *  hình env (QC là tuỳ chọn — không vỡ sync logistics). Phân trang 500/lần. */
export async function listAllQcRecords(): Promise<LarkRecord[]> {
  const qcTableId = process.env.LARK_QC_TABLE_ID;
  if (!qcTableId) return [];
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${qcTableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as {
      code: number; msg: string;
      data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean };
    };
    if (j.code !== 0) throw new Error(`[lark] QC list fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}
