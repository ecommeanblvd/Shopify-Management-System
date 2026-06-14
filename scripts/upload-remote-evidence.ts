/**
 * Upload a remote/ODA/RAL source file (the carrier's published list or
 * surcharge sheet) to object storage as evidence and record it in
 * `carrier_remote_evidence`. Mirrors the rate-card PDF evidence flow.
 *
 * Single file:
 *   pnpm tsx scripts/upload-remote-evidence.ts \
 *     --account "DHL Express Vietnam — Worldwide Export 2026" \
 *     --file "/path/to/list.pdf" --label "DHL Remote Areas 2025" \
 *     --from 2025-01-01 --to 2026-01-01 --apply
 *
 * Known batch (the files imported this cycle, found in ~/Downloads):
 *   pnpm tsx scripts/upload-remote-evidence.ts --batch --apply
 *
 * Idempotent: skips a file already recorded for the same (account, label, filename).
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { isStorageConfigured, putObject } from '@/lib/storage/s3';
import { randomUUID } from 'crypto';

interface Item { account: string; file: string; label: string; from: string | null; to: string | null; }

const HOME = process.env.HOME ?? '';
const FEDEX = 'FedEx Vietnam — International Priority (IP) 2026';
const DHL = 'DHL Express Vietnam — Worldwide Export 2026';

const BATCH: Item[] = [
  { account: FEDEX, file: `${HOME}/Downloads/ODA_OPA_tiers_codes_1-13-25_to_7-13-25.xlsx`, label: 'FedEx ODA Jan-2025', from: '2025-01-13', to: '2025-07-14' },
  { account: FEDEX, file: `${HOME}/Downloads/ODA_OPA_tiers_codes_7-14-25_to_1-11-26.xlsx`, label: 'FedEx ODA Jul-2025', from: '2025-07-14', to: '2026-01-12' },
  { account: FEDEX, file: `${HOME}/Downloads/fedex-rates-sur-vi-vn-2025.pdf`, label: 'FedEx phụ phí ODA/OPA 2025 (bảng giá)', from: '2025-01-01', to: '2026-01-01' },
  { account: FEDEX, file: `${HOME}/Downloads/fedex-rates-ficp-sur-vi-vn-2026.pdf`, label: 'FedEx phụ phí ODA/OPA 2026 (bảng giá)', from: '2026-01-01', to: null },
  { account: DHL, file: `${HOME}/Downloads/dhl-express-remote-area-list-2025.pdf`, label: 'DHL Remote Areas 2025', from: '2025-01-01', to: '2026-01-01' },
  { account: DHL, file: `${HOME}/Downloads/service_and_rate_guide_vn_vi_2025 (1).pdf`, label: 'DHL Service & Rate Guide 2025 (giá remote)', from: '2025-01-01', to: '2026-01-01' },
];

function contentTypeFor(file: string): string {
  if (file.endsWith('.pdf')) return 'application/pdf';
  if (file.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (file.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

function parseArgs(): { items: Item[]; apply: boolean } {
  const a = process.argv.slice(2);
  const apply = a.includes('--apply');
  if (a.includes('--batch')) return { items: BATCH, apply };
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const file = get('--file'); const account = get('--account'); const label = get('--label');
  if (!file || !account || !label) throw new Error('Need --batch, or --file --account --label [--from --to]');
  const nz = (v: string | undefined) => (v && v !== 'null' ? v : null);
  return { items: [{ account, file, label, from: nz(get('--from')), to: nz(get('--to')) }], apply };
}

async function main(): Promise<void> {
  if (!isStorageConfigured()) throw new Error('Object storage not configured (S3_* env).');
  const { items, apply } = parseArgs();

  for (const it of items) {
    if (!existsSync(it.file)) { console.log(`⚠️  SKIP (missing): ${it.file}`); continue; }
    const [account] = await db.select({ id: schema.carrierAccounts.id })
      .from(schema.carrierAccounts).where(eq(schema.carrierAccounts.name, it.account));
    if (!account) { console.log(`⚠️  SKIP (no account "${it.account}")`); continue; }

    const filename = basename(it.file);
    const [dupe] = await db.select({ id: schema.carrierRemoteEvidence.id })
      .from(schema.carrierRemoteEvidence)
      .where(and(
        eq(schema.carrierRemoteEvidence.carrierAccountId, account.id),
        eq(schema.carrierRemoteEvidence.label, it.label),
        eq(schema.carrierRemoteEvidence.filename, filename),
      )).limit(1);
    if (dupe) { console.log(`= exists: ${it.label} / ${filename}`); continue; }

    const buf = readFileSync(it.file);
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const key = `remote-evidence/${account.id}/${randomUUID()}${ext}`;
    console.log(`${apply ? '⬆️  upload' : '🔎 would upload'}: ${it.label} (${filename}, ${(buf.length / 1024).toFixed(0)} KB) → ${key}`);
    if (apply) {
      await putObject(key, new Uint8Array(buf), contentTypeFor(it.file));
      await db.insert(schema.carrierRemoteEvidence).values({
        carrierAccountId: account.id, label: it.label,
        effectiveFrom: it.from, effectiveTo: it.to,
        fileKey: key, filename, contentType: contentTypeFor(it.file), byteSize: buf.length,
      });
    }
  }
  console.log(apply ? '\n✅ done' : '\n🔎 dry-run (add --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit());
