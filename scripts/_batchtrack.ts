import { trackPendingShipments } from '@/features/shipments/track';
import { trackPendingShipHo } from '@/features/ship-ho/track';
(async () => {
  const s1 = await trackPendingShipments({ limit: 300 });
  console.log('shipments:', JSON.stringify(s1));
  const s2 = await trackPendingShipHo({ limit: 50 });
  console.log('ship-ho:', JSON.stringify(s2));
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
