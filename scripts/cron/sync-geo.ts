/**
 * Cron: refresh geo master cho các nước đã nạp (geo_imports). Railway monthly.
 * Exit 0 xong; 1 fatal.
 */
import { db, schema } from '@/db/client';

async function main(): Promise<void> {
  const imported = await db.select({ cc: schema.geoImports.countryCode }).from(schema.geoImports);
  if (imported.length === 0) { process.stdout.write('sync-geo: chưa có nước nào — bỏ qua\n'); return; }
  const { spawnSync } = await import('node:child_process');
  const list = imported.map((r) => r.cc).join(',');
  const r = spawnSync('npx', ['tsx', 'scripts/import-geonames.ts', '--country', list, '--apply'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`import-geonames exit ${r.status}`);
}

main().catch((err) => { process.stderr.write(`sync-geo: fatal: ${err instanceof Error ? err.stack : String(err)}\n`); process.exitCode = 1; }).finally(() => process.exit());
