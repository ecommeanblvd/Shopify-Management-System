/**
 * Gọi Google Sheets API bằng tài khoản dịch vụ.
 *
 * Tự ký JWT bằng `node:crypto` thay vì kéo thư viện `googleapis` — thư viện đó mang theo cả
 * gRPC trong khi ta chỉ cần vài lệnh REST. Giữ token trong RAM đúng nếp `features/lark/client.ts`.
 *
 * Tài khoản dịch vụ KHÔNG tạo được file mới: đo 03/10/2026 thì Drive trả `storageQuotaExceeded`
 * vì nó không có dung lượng Drive riêng. Nó chỉ đọc/ghi sheet đã được chia sẻ quyền `writer`.
 */
import { createSign } from 'node:crypto';

const PHAM_VI = 'https://www.googleapis.com/auth/spreadsheets';
/** Google/Excel đếm ngày từ 30/12/1899. */
const GOC_SERIAL = Date.UTC(1899, 11, 30);
const b64 = (s: string) => Buffer.from(s).toString('base64url');
let nho: { token: string; het: number } | null = null;

/** `YYYY-MM-DD` → số thứ tự ngày của Google Sheets. */
export function serialNgay(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - GOC_SERIAL) / 86_400_000);
}

/** Chiều ngược của `serialNgay`. */
export function tuSerial(n: number): string {
  return new Date(GOC_SERIAL + n * 86_400_000).toISOString().slice(0, 10);
}

function env(ten: string): string {
  const v = process.env[ten];
  if (!v) throw new Error(`[google] thiếu biến ${ten}`);
  return v;
}

export async function tokenGoogle(): Promise<string> {
  if (nho && nho.het > Date.now() + 60_000) return nho.token;
  // Railway lưu xuống dòng thành hai ký tự "\n" — phải đổi lại thành xuống dòng thật, không
  // thì `createSign` từ chối khoá với một thông báo chẳng liên quan gì tới nguyên nhân.
  const key = env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const dau = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({
    iss: env('GOOGLE_SA_EMAIL'), scope: PHAM_VI,
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  }))}`;
  const chuKy = createSign('RSA-SHA256').update(dau).end().sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${dau}.${chuKy}` }),
    // Không timeout là kết nối treo làm cron treo vĩnh viễn — cùng lý do ở `lark/client.ts`.
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`[google] lấy token hỏng: ${j.error_description ?? r.status}`);
  // Google cấp 3600s; giữ 3000s để luôn đổi khoá trước khi hết hạn.
  nho = { token: j.access_token, het: Date.now() + 3_000_000 };
  return nho.token;
}

export async function goiSheets(
  sheetId: string, duong: string, init?: RequestInit,
): Promise<Record<string, unknown>> {
  const t = await tokenGoogle();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${duong}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const j = await r.json() as Record<string, unknown>;
  if (!r.ok) throw new Error(`[google] HTTP ${r.status}: ${JSON.stringify((j as { error?: unknown }).error).slice(0, 300)}`);
  return j;
}
