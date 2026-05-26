import { fetchFedExFuelPercent } from '@/features/carrier-rates/fuel-fetcher/fedex';

async function main(): Promise<void> {
  const r = await fetchFedExFuelPercent();
  console.log('sourceUrl :', r.sourceUrl);
  console.log('fetchedAt :', r.fetchedAt.toISOString());
  console.log('current   :', r.current);
  console.log('rows[1-3] :', r.rows.slice(1, 4));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
