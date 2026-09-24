/**
 * Lark Suite Bitable API client. Token cache trong RAM.
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

// Bảng Lark "WH ngày MEAN nhận hàng" (base RIÊNG — app_token = wiki node, dùng
// trực tiếp được). Cột 'Visible - WH-Ngày MEAN nhận hàng gần nhất' = ngày nhận.
// app_token/table_id không phải secret nên để hằng số (env override nếu có).
const BRAND_RECV_APP_TOKEN = process.env.LARK_BRAND_RECV_APP_TOKEN ?? 'HxfAw0iRViHiNgkSlbBltpVkg3f';
const BRAND_RECV_TABLE_ID = process.env.LARK_BRAND_RECV_TABLE_ID ?? 'tblFtdIn8H7ftfBL';

// Bảng Lark "đơn ship hộ" đội logistics dùng để lên đơn cho khách (CEO 11/09/2026).
// app_token lấy thẳng từ link wiki; không phải secret nên để hằng số, env override được.
const SHIP_HO_APP_TOKEN = process.env.LARK_SHIP_HO_APP_TOKEN ?? 'HmG6wtdeoiAPflkereXl8pNXgzL';
const SHIP_HO_TABLE_ID = process.env.LARK_SHIP_HO_TABLE_ID ?? 'tblJQXEuCBxVPRek';

// Bảng "WH - Inventory (Nhập, QC, Pack)" — cột "Select VTĐG1" của LOG-Export link tới đây;
// tên hộp nằm ở cột "Lineitem SKU final" (vd MEAN-BOX-42x30x10-CAR-02). Không phải secret.
const WH_INVENTORY_TABLE_ID = process.env.LARK_WH_INVENTORY_TABLE_ID ?? 'tblfnOiEwzcXmemM';
const COT_TEN_HOP = 'Lineitem SKU final';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const res = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env('LARK_APP_ID'), app_secret: env('LARK_APP_SECRET') }),
    // Không timeout → kết nối treo là container cron treo VĨNH VIỄN, Railway không
    // xếp lịch run mới (gap 17–20/07). 30s là quá đủ cho 1 call Lark.
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number };
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`[lark] token fail: code=${j.code} msg=${j.msg}`);
  cachedToken = { token: j.tenant_access_token, expiresAt: now + (j.expire ?? 7200) * 1000 };
  return cachedToken.token;
}

export interface LarkRecord { record_id: string; fields: Record<string, unknown>; created_time?: number; }

/** Body cho records/search filter theo "Order Number". Khớp CẢ dạng có '#' và
 *  không '#' (Shopify lưu '#MBLVD..' hoặc 'TA..'; Lark có thể khác) → conjunction
 *  'or' hai điều kiện. THUẦN để unit-test. */
export function buildOrderNumberSearchBody(orderNumber: string): Record<string, unknown> {
  const bare = orderNumber.replace(/^#/, '');
  const forms = [bare, `#${bare}`];
  return {
    filter: {
      conjunction: 'or',
      conditions: [
        ...forms.map((v) => ({ field_name: 'Order Number', operator: 'is', value: [v] })),
        // Kiện GỘP nhiều đơn dính liền trong một ô ("#MBLVD30321#MBLVD30322") nên phép so
        // bằng trượt hết. 'contains' bắt được, còn việc lọc chính xác thì caller làm bằng
        // tachMaDon — 'contains' có thể bắt nhầm mã ngắn hơn (CEO 22/09/2026).
        { field_name: 'Order Number', operator: 'contains', value: [`#${bare}`] },
      ],
    },
    automatic_fields: true,
    page_size: 500,
  };
}

/** POST records/search 1 table, phân trang hết, trả mọi item (kèm created_time
 *  nhờ automatic_fields). body: filter (optional) + automatic_fields + page_size. */
async function searchAllRecords(tableId: string, body: Record<string, unknown>, appTokenOverride?: string): Promise<LarkRecord[]> {
  const token = await getTenantToken();
  const appToken = appTokenOverride ?? env('LARK_BASE_APP_TOKEN');
  const out: LarkRecord[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`);
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json()) as { code: number; msg: string; data?: { items?: LarkRecord[]; page_token?: string; has_more?: boolean } };
    if (j.code !== 0) throw new Error(`[lark] search fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}

async function putRecord(appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { code: number; msg: string };
  if (j.code !== 0) throw new Error(`[lark] update fail: code=${j.code} msg=${j.msg}`);
}

async function postRecord(appToken: string, tableId: string, fields: Record<string, unknown>): Promise<string> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { code: number; msg: string; data?: { record?: { record_id?: string } } };
  if (j.code !== 0 || !j.data?.record?.record_id) throw new Error(`[lark] create fail: code=${j.code} msg=${j.msg}`);
  return j.data.record.record_id;
}

/**
 * GHI đè vài trường của MỘT record bảng logistics.
 *
 * Đường ghi vào Lark giữ HẸP có chủ đích: chỉ record_id + đúng trường cần đổi,
 * không có API xoá, để một lỗi lập trình không thể quét sạch bảng vận hành.
 * Từ 09/2026 có thêm bảng "WH ngày MEAN nhận hàng" (hai hàm dưới) — vẫn chỉ
 * sửa/tạo từng record, không xoá.
 */
export async function updateLogRecordFields(recordId: string, fields: Record<string, unknown>): Promise<void> {
  return putRecord(env('LARK_BASE_APP_TOKEN'), logTableId(), recordId, fields);
}

/** Sửa vài trường của một record bảng "WH ngày MEAN nhận hàng". */
export async function updateBrandReceivedRecordFields(recordId: string, fields: Record<string, unknown>): Promise<void> {
  return putRecord(BRAND_RECV_APP_TOKEN, BRAND_RECV_TABLE_ID, recordId, fields);
}

/** Tạo MỘT record bảng "WH ngày MEAN nhận hàng". Trả record_id. */
export async function createBrandReceivedRecord(fields: Record<string, unknown>): Promise<string> {
  return postRecord(BRAND_RECV_APP_TOKEN, BRAND_RECV_TABLE_ID, fields);
}

/** Đọc TẤT CẢ record của bảng (phân trang page_token, 500/lần). */
export async function listAllRecords(): Promise<LarkRecord[]> {
  return searchAllRecords(logTableId(), { automatic_fields: true, page_size: 500 });
}

/** Mã lỗi Lark khi record_id không tồn tại (đã xoá) — coi là "không có", không phải lỗi API. */
const LARK_RECORD_NOT_FOUND = 1254043;

/**
 * Đọc MỘT record bảng logistics theo record_id (webhook /api/lark/pack). Trả null nếu
 * record không còn. Lỗi mạng/API khác → throw (caller trả 502 để Lark thử lại).
 */
export async function getLogRecordById(recordId: string): Promise<LarkRecord | null> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${env('LARK_BASE_APP_TOKEN')}/tables/${logTableId()}/records/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json()) as { code: number; msg: string; data?: { record?: LarkRecord } };
  if (j.code === LARK_RECORD_NOT_FOUND) return null;
  if (j.code !== 0) throw new Error(`[lark] get record fail: code=${j.code} msg=${j.msg}`);
  return j.data?.record ?? null;
}

/** Tìm record Lark theo "Log Unique code" (PK-…). Read-only. */
export async function searchRecordsByLogCode(logCode: string): Promise<LarkRecord[]> {
  if (!logCode.trim()) return [];
  return searchAllRecords(logTableId(), {
    filter: { conjunction: 'and', conditions: [{ field_name: 'Log Unique code', operator: 'is', value: [logCode.trim()] }] },
    automatic_fields: true, page_size: 500,
  });
}

/** Tìm record Lark theo Order Number (cả 2 dạng #). Read-only. Phân trang. */
export async function searchRecordsByOrderNumber(orderNumber: string): Promise<LarkRecord[]> {
  if (!orderNumber.trim()) return [];
  return searchAllRecords(logTableId(), buildOrderNumberSearchBody(orderNumber));
}

/** Đọc TẤT CẢ record bảng brand-received (đơn × SKU × ngày MEAN nhận). Phân trang. */
export async function listBrandReceivedRecords(): Promise<LarkRecord[]> {
  return searchAllRecords(BRAND_RECV_TABLE_ID, { automatic_fields: true, page_size: 500 }, BRAND_RECV_APP_TOKEN);
}

/** Đọc TẤT CẢ record của QC table (env LARK_QC_TABLE_ID). Trả [] nếu chưa cấu
 *  hình env (QC là tuỳ chọn — không vỡ sync logistics). Phân trang 500/lần. */
export async function listAllQcRecords(): Promise<LarkRecord[]> {
  const qcTableId = process.env.LARK_QC_TABLE_ID;
  if (!qcTableId) return [];
  return searchAllRecords(qcTableId, { automatic_fields: true, page_size: 500 });
}

// Bảng "WH - Inventory (Nhập, QC, Pack)" — mỗi dòng = 1 đơn vị hàng vật lý.
// Cùng base LARK_BASE_APP_TOKEN với logistics. View "Qly tồn kho tổng hợp" đã lọc
// sẵn tồn tổng hợp. table_id/view_id không phải secret → hằng số (env override).
const WH_TABLE_ID = process.env.LARK_WH_TABLE_ID ?? 'tblfnOiEwzcXmemM';
const WH_VIEW_ID = process.env.LARK_WH_VIEW_ID ?? 'vewFAl8NQG';

/** Đọc TẤT CẢ record view tồn kho tổng hợp (mỗi dòng = 1 đơn vị). Phân trang 500/lần. */
export async function listWarehouseStockRecords(): Promise<LarkRecord[]> {
  return searchAllRecords(WH_TABLE_ID, { view_id: WH_VIEW_ID, page_size: 500 });
}

/** Mọi dòng bảng đơn ship hộ của đội logistics. */
export async function listShipHoDonRecords(): Promise<LarkRecord[]> {
  return searchAllRecords(SHIP_HO_TABLE_ID, { automatic_fields: true, page_size: 500 }, SHIP_HO_APP_TOKEN);
}

// Tên hộp theo record kho — mỗi kiện link tới MỘT dòng kho riêng nên cache chỉ giúp khi
// webhook bắn lại cùng dòng; giới hạn để không phình bộ nhớ tiến trình web.
const tenHopCache = new Map<string, string | null>();

/**
 * Tên hộp đóng gói (vd "MEAN-BOX-42x30x10-CAR-02") theo record kho mà cột "Select VTĐG1"
 * của dòng LOG-Export trỏ tới. Lark chỉ trả mã liên kết ở cột đó, không trả tên.
 *
 * BEST-EFFORT: lỗi mạng/không tìm thấy → null. Tên hộp chỉ để Đức nhìn, không được phép
 * làm hỏng việc ghi kiện.
 */
export async function getTenHopVtdg(recordId: string): Promise<string | null> {
  const daCo = tenHopCache.get(recordId);
  if (daCo !== undefined) return daCo;
  try {
    const token = await getTenantToken();
    const url = `${DOMAIN}/open-apis/bitable/v1/apps/${env('LARK_BASE_APP_TOKEN')}/tables/${WH_INVENTORY_TABLE_ID}/records/${encodeURIComponent(recordId)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const j = (await res.json()) as { code: number; data?: { record?: { fields?: Record<string, unknown> } } };
    const v = j.code === 0 ? j.data?.record?.fields?.[COT_TEN_HOP] : null;
    const ten = typeof v === 'string' ? v.trim()
      : Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : '')).join('').trim()
      : null;
    const kq = ten || null;
    if (tenHopCache.size > 2000) tenHopCache.clear();
    tenHopCache.set(recordId, kq);
    return kq;
  } catch {
    return null;
  }
}

/**
 * Dòng bảng kho của MỘT đơn. Lọc theo mã đơn (cột text) chứ không đọc cả bảng 9.000 dòng —
 * lọc theo liên kết món thì Lark không hỗ trợ, nên SMS lọc tiếp phía mình (locDongTheoMon).
 */
export async function searchWhInventoryByDon(orderNumber: string): Promise<LarkRecord[]> {
  const bare = orderNumber.replace(/^#/, '');
  if (!bare) return [];
  return searchAllRecords(WH_INVENTORY_TABLE_ID, {
    filter: {
      conjunction: 'or',
      conditions: [bare, `#${bare}`].map((v) => ({ field_name: 'Order Number final', operator: 'is', value: [v] })),
    },
    automatic_fields: true, page_size: 500,
  });
}

/** Một cột của bảng Lark. Cột CHỌN có sẵn danh sách lựa chọn ở property.options. */
export interface LarkField {
  field_name: string;
  type?: number;
  property?: { options?: { name?: string }[] } | null;
}

/**
 * Danh sách cột của bảng kho, kèm lựa chọn của các cột CHỌN.
 *
 * Dùng để chặn việc ghi một giá trị lạ vào cột chọn: Lark sẽ đẻ thêm lựa chọn mới và làm hỏng
 * bộ lọc/báo cáo của cả đội (spec §5). Chỉ ĐỌC, không sửa gì.
 */
export async function listWhInventoryFields(): Promise<LarkField[]> {
  const token = await getTenantToken();
  const appToken = env('LARK_BASE_APP_TOKEN');
  const out: LarkField[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${WH_INVENTORY_TABLE_ID}/fields`);
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    const j = (await res.json()) as { code: number; msg: string; data?: { items?: LarkField[]; page_token?: string; has_more?: boolean } };
    if (j.code !== 0) throw new Error(`[lark] fields fail: code=${j.code} msg=${j.msg}`);
    out.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data?.page_token : undefined;
  } while (pageToken);
  return out;
}

/** Tạo MỘT dòng bảng kho. Trả record id. */
export async function createWhInventoryRecord(fields: Record<string, unknown>): Promise<string> {
  return postRecord(env('LARK_BASE_APP_TOKEN'), WH_INVENTORY_TABLE_ID, fields);
}

/** Sửa vài cột của MỘT dòng bảng kho. */
export async function updateWhInventoryRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
  return putRecord(env('LARK_BASE_APP_TOKEN'), WH_INVENTORY_TABLE_ID, recordId, fields);
}

// ── Bảng "WH - Inventory (Nhập, QC, Pack)" — luồng Nhận & Kiểm hàng ───────────
//
// CEO 24/09 cho phép TẠO và XOÁ trên bảng này, sửa lại D-045 (vốn cấm hẳn xoá).
// Kèm BỐN hàng rào, ba cái đầu nằm ở tầng gọi (`features/kho-nhan/day-wh-lark.ts`):
//   1. chỉ xoá record do CHÍNH hệ thống tạo — id lấy từ `goods_receipt_items.lark_record_id`,
//      KHÔNG BAO GIỜ xoá theo điều kiện lọc;
//   2. một record mỗi lượt gọi, không có xoá hàng loạt, không vòng lặp xoá;
//   3. đọc lại và đối chiếu trước khi xoá;
//   4. ghi nhật ký mọi lượt vào `wh_lark_nhat_ky`, kể cả lượt hỏng.

/** Đọc MỘT record bảng WH - Inventory. Trả null nếu record không còn. */
export async function getWhInventoryRecord(recordId: string): Promise<LarkRecord | null> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${env('LARK_BASE_APP_TOKEN')}/tables/${WH_INVENTORY_TABLE_ID}/records/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json()) as { code: number; msg: string; data?: { record?: LarkRecord } };
  if (j.code === LARK_RECORD_NOT_FOUND) return null;
  if (j.code !== 0) throw new Error(`[lark] get wh record fail: code=${j.code} msg=${j.msg}`);
  return j.data?.record ?? null;
}

/**
 * Xoá MỘT record bảng WH - Inventory, theo record_id ĐÍCH DANH.
 *
 * Hàm này CỐ Ý không nhận điều kiện lọc, không nhận mảng, không có biến thể
 * xoá-nhiều. Đó là cách duy nhất để một lỗi lập trình không thể quét sạch bảng
 * vận hành của đội logistics (lý do gốc của D-045).
 *
 * Record đã biến mất → coi như xong, không ném: hai người cùng gỡ một chiếc thì
 * người sau không được thấy lỗi đỏ.
 */
export async function deleteWhInventoryRecord(recordId: string): Promise<void> {
  const token = await getTenantToken();
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${env('LARK_BASE_APP_TOKEN')}/tables/${WH_INVENTORY_TABLE_ID}/records/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json()) as { code: number; msg: string };
  if (j.code === LARK_RECORD_NOT_FOUND) return;
  if (j.code !== 0) throw new Error(`[lark] delete wh record fail: code=${j.code} msg=${j.msg}`);
}
