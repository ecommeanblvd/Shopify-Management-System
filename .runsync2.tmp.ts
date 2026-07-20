import { syncLarkPacks } from '@/features/lark/sync';
(async () => {
  const r = await syncLarkPacks();
  console.log(`larkStatusUpserted=${r.larkStatusUpserted} deliveryFrozen=${r.deliveryFrozen}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1); });
