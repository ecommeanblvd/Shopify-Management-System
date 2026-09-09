import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { taiWorkbook } from '@/features/cogs/bang-ke-import';
import { docWorkbook } from '@/features/cogs/doc-bang-ke';
const B: Array<[string, string]> = [
  ['denio', '1HNqRWYk_yoYQe6c1tj8eQbSEGp1_zeO3EKbpTgoAVvg'], ['happy-clothing', '1jNUPHo2YVom1QG7R5a6STW8G-CMoClUHMwDmXsEDdH4'],
  ['calista-de-minh-thanh', '15eSvbciOJhaLPhNljkppG1njchYX8uIOG_zJnw-ZaH0'], ['la-vierge', '1gWbfb20rE-CGCoA21dUrcNuEPsMqg3rH_3FNc4W8so4'],
  ['poem', '1XY4_t6JZ0K5AdsW9bHCtceKhfOqciSSTjPUlZXO5H7E'], ['white-plan', '16DtBVvyN4-2AaUyvHj2E-a7Otskvh3uMD-zPOfBH56Q'],
  ['linh-phung', '1NZdvIHRnLN0QDlkaTrnPBPtPoQ5dtWUak_HE0hxe8dM'], ['montsand', '1LTxzcgxecHmTcR1vJoID_0GHROtpRvXnzszgCShbi48'],
  ['keira-tong', '1b0R6FkHErkHLRSYFGtBKGmFop61qxru_KdzCngCM8z8'], ['maison-des-copains', '10CKi8j7MgTROKtXLLxm__vwTuYDgDCyiV2bcqm4zpcs'],
  ['rosee-de-matin', '1ZKTVpaot1RnMhxBto-Y8gcdjxIYNjmh0yads4-giGyE'], ['tracy-studio', '1MGUp286rnApZLhQRA4zinkSVN78X71-zpaSSSAVYc2E'],
  ['eegen-studio', '1ewPqSoMPMFXebseGUOewV3gJntGf7KQpnO385Kjbpik'], ['larmes', '1gTJtQNr8fvsrBSUdN5a8h1Jtm4GLkg6OgzoIlkxziGk'],
  ['laling', '1WIrzQNAgxeY3svWwwcPdJAoCS57ZeRQ4TH6hkxvoUyQ'], ['jenny-k-tran-divine', '1xz9kypV6xqkmXLM9_9O7GHSZVrf629NuKeRRR2GyFUE'],
  ['das-la-vie', '1DgAROx0FS9cdA-uAIuTE_66dCzwpP76U_XTnJ-4XrXU'], ['detheia', '1C-GHCWF0r09THksGsm1XgjlMtF9mfvedOXvynCbjDLw'],
  ['l-scarlett', '12eWx2TIm4UPmCCeD4aDYLV4PHQQAxBszYI0XlerUw4U'], ['tinh-atelier', '1890l3KDBJghzXgo7KL-FBifaWakbsYPOYW3rutgQDCg'],
  ['nhat-vy', '1odlSdXHtqiONIAh1npd9KsftS3nUCO7dVShPQ5LtE2w'], ['lamai-atelier', '1012jhDRM6ffmiM9LSqT01BG5h3uLJ-JvVwLkN3I7PpE'],
  ['mirer', '1JQ86o5wLKefbPeuMZExRgCf3cDmL3BLuk4iLFMmjHRY'], ['echele', '1IW3TIUt8hvZoj_JO-ndIaHyAFhEHzEfR8UmUpubXmOw'],
  ['beloved', '1bT0zuZPjqagemFtOpcB8Fg0LKggPL7KIe-FAEBq_3cQ'], ['sissy-nation', '1XAy8k5nt6ZOVFhPNm_1IbFBm0w1ScMSwdihRMs-7rmk'],
  ['darling-diva', '1fxj3b19t_dZRZWiAxYxZwOiyi5zRs_e8gzKE5rQqdvc'], ['lassy', '15GhKFpRbaZt0zKmGVd-pX_uU34_FEtY7CxaE7bIECDY'],
  ['jadeite-t-h', '1isr_Ru3cefDq7eJp07wwo_6MLNtDalkR1EeUzRbx07s'], ['seychas', '1rppA7ScRa0LHXRCPzEKi30sF1t8_Dh9NKadxfHux56k'],
  ['arti-apparel', '1KecrkTVvJ32l2oJ3c0M_PUsKgjpPTjrL8n3Iy2WMkjY'], ['lamoris', '1iThIXeBs_lEUQOP7ep8pIZSRX4fsZktDnee64qKnjIE'],
  ['delicate', '1dCDT-e_9mlvPQF0gSNbr_yY0pbPogdjYtIeHgX8YeLw'], ['ritara', '1EFvcKlElZ_FOhTS_ZRMHPFWrtvICpIZPl-6gky72pFE'],
  ['sodope-club', '1zLSGQCyQ9nU9_P1iIiywAf5XgX9o05ptbeezpQzKzmg'], ['huelleyrose', '1ULLUE1UTVNT0ZMnnO_Ht4we59FghtUgPGWiuVuYiFIQ'],
  ['cordia', '1WtCTgkbsevezGboivAP15hqLW61rKCP1GtkUEH0ll8U'], ['lovelyn', '1WoQhP1LOrDNlJ1g4VlwHBzAFZXm8ehY37_JLCI3zaKM'],
  ['lyp', '1CNwoYMZJWCW40N5kdIPwekkWEHxqIvOdZljLk1RDx98'], ['thesong', '11NqDq23amQXKxuCm8JSQGpDuiKnO1fsDMrLeZdE5Uos'],
  ['raffine', '1TjqYqaP-5RqNED5dfMZT3ZyzKlZZ7bEBT5sXje_ErMk'], ['decode-house', '1BO-DztUR_0ZiozzWcT0EYCyJQoYq_tmrnORPEs8Z-eA'],
  ['kalisa', '1vamafL4-4hAWBL5O4AGT6V2BZEgvJDWlD1ZSm3qDsPo'], ['margee-atelier', '1RIGPZQZTwEp__chNROixuquAcSDCQ1vOqblGTiA7tEU'],
  ['white-chic', '1pcA5VeOlzH1VtEysL0PZYrlzqCCiLUDlXbUKsQPTdcw'], ['i-h-f', '1ZQ6vRsYp2WrO7oi-NlUwehOQ6-zpMLUR69KrohinE1Q'],
  ['angeletta', '1rvLbmzdVvoQZlT8IxcoXCYUzup_RVizrT0ZFd-yIFlI'], ['docemeo', '1n47CScA0zAMp1-_uIDtQ1XKLH5x5tI04VXjWQxCFcsU'],
  ['maddy-hates-rose', '1AKR_rl3XeZx6fpeDhd15VsGgSn3zXKGd1wRBjt6iQFg'], ['lecia-rtw', '1CHHaTzyeVf7DcXKT49_--l6VPMIqIgW53rx6DdWu_oQ'],
];
const KNOWN: Record<string, number> = { 'denio|2026-06': 750000, 'denio|2026-05': 200000, 'denio|2026-01': 1674000, 'darling-diva|2026-03': 1597222 };
(async () => {
  const TU = process.argv[2] ?? ''; let bat = !TU; let bad = 0; const lech: string[] = [];
  for (const [slug, id] of B) {
    if (!bat) { if (slug === TU) bat = true; else continue; }
    let sheets: Awaited<ReturnType<typeof taiWorkbook>> | null = null; for (let k = 0; k < 4 && !sheets; k++) { try { sheets = await taiWorkbook({ url: `https://docs.google.com/spreadsheets/d/${id}/edit` }); } catch { await new Promise((r) => setTimeout(r, 5000)); } }
    if (!sheets) { console.log('✗ không tải được', slug); bad++; continue; }
    const { bangKe } = docWorkbook(sheets);
    const rows = await db.execute(sql`select period, sum(amt)::numeric as s from (
      select period, amount as amt from order_line_cogs where brand_slug=${slug} and source='brand_statement'
      union all select period, amount from brand_cogs_offline where brand_slug=${slug} and source='brand_statement') t group by period`);
    const list = (((rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])) as Array<{ period: string; s: string }>);
    const dbMap = new Map(list.map((r) => [r.period, Number(r.s)] as const));
    const byP = new Map<string, number>();
    for (const bk of bangKe) { if (!bk.lines.length && !bk.returns.length) continue; byP.set(bk.period, (byP.get(bk.period) ?? 0) + bk.lines.reduce((s, d) => s + d.tt, 0) - bk.returns.reduce((s, d) => s + d.tt, 0)); }
    for (const [period, sheetSum] of byP) {
      if (period < '2026-01') continue;
      const dbSum = dbMap.get(period) ?? 0; const diff = Math.round(sheetSum - dbSum);
      const ok = Math.abs(diff) <= 2 || KNOWN[`${slug}|${period}`] === diff; if (!ok) { bad++; lech.push(`${slug}|${period}`); console.log(`✗ ${slug} ${period} sheet ${Math.round(sheetSum)} db ${Math.round(dbSum)} diff ${diff}`); }
    }
  }
  console.log(bad ? `✗ ${bad} lệch: ${lech.join(' ')}` : '✓ tất cả khớp'); process.exit(bad ? 1 : 0);
})();
