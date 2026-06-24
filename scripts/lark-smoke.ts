/**
 * Read-only Lark Bitable smoke test — KHÔNG ghi gì, chỉ đọc.
 * Mục đích: xác nhận app/base access chạy + in tên field thật của bảng
 * "Tạo pack/ tracking" để chốt mapping. Throwaway, chưa phải feature.
 *
 * Chạy (credential lấy từ Railway, không lưu local):
 *   railway run npx tsx scripts/lark-smoke.ts
 *
 * Cần env: LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_APP_TOKEN, LARK_LOG_TABLE_ID
 * (fallback LARK_TABLE_ID cũ)
 * (LARK_DOMAIN optional — mặc định open.larksuite.com)
 */
const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';

function need(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`❌ thiếu env ${k}`); process.exit(1); }
  return v;
}

async function main() {
  const appId = need('LARK_APP_ID');
  const appSecret = need('LARK_APP_SECRET');
  const appToken = need('LARK_BASE_APP_TOKEN');
  const tableId = process.env.LARK_LOG_TABLE_ID ?? need('LARK_TABLE_ID');
  console.log(`domain=${DOMAIN}\nappId=${appId.slice(0, 6)}…  base=${appToken.slice(0, 8)}…  table=${tableId.slice(0, 8)}…\n`);

  // 1) tenant_access_token
  const tokRes = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tok = await tokRes.json() as { code: number; msg: string; tenant_access_token?: string };
  if (tok.code !== 0 || !tok.tenant_access_token) {
    console.error(`❌ lấy token THẤT BẠI: code=${tok.code} msg="${tok.msg}"`);
    console.error('   → thường do App ID/Secret sai, hoặc app chưa publish/enable.');
    process.exit(1);
  }
  console.log('✅ tenant_access_token OK\n');

  // 2) list 2 records
  const url = `${DOMAIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=2`;
  const recRes = await fetch(url, { headers: { Authorization: `Bearer ${tok.tenant_access_token}` } });
  const rec = await recRes.json() as {
    code: number; msg: string;
    data?: { total?: number; items?: Array<{ record_id: string; fields: Record<string, unknown> }> };
  };
  if (rec.code !== 0) {
    console.error(`❌ đọc records THẤT BẠI: code=${rec.code} msg="${rec.msg}"`);
    if (rec.code === 91402 || rec.code === 1254005 || String(rec.msg).includes('permission') || String(rec.msg).includes('NOTEXIST')) {
      console.error('   → app CHƯA được cấp quyền vào Base, hoặc APP_TOKEN/TABLE_ID sai.');
      console.error('   → mở Base → "…"/Share → add app làm collaborator (can view). Base "External" có thể phải nhờ chủ sở hữu cấp, hoặc duplicate về workspace của bạn.');
    }
    process.exit(1);
  }

  const items = rec.data?.items ?? [];
  console.log(`✅ đọc OK — total≈${rec.data?.total ?? '?'}, lấy ${items.length} record mẫu.\n`);
  if (items.length === 0) { console.log('(bảng rỗng hoặc view lọc hết — vẫn coi như kết nối OK)'); return; }

  console.log('=== TÊN FIELD (key) của record đầu tiên ===');
  console.log(Object.keys(items[0].fields).join('  |  '));
  console.log('\n=== MẪU 1 RECORD (rút gọn) ===');
  for (const [k, v] of Object.entries(items[0].fields)) {
    let show = JSON.stringify(v);
    if (show && show.length > 120) show = show.slice(0, 120) + '…';
    console.log(`  • ${k}: ${show}`);
  }
}

main().catch((e) => { console.error('❌ lỗi:', e?.message ?? e); process.exit(1); });
