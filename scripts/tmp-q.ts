import { db } from '@/db/client';
(async () => {
  const q = async (t: string, s: string, p: unknown[] = []) => { try { console.log(t, JSON.stringify((await db.$client.query(s, p as never[])).rows).slice(0, 1400)); } catch (e) { console.log(t, 'ERR', String(e).slice(0, 160)); } };
  await q('cost_override toàn hệ:', `select count(*)::int lines_tong, count(cost_override)::int co_override from shopify_order_lines`);
  await q('override theo store + có giá thực chưa:', `select left(o.store_id::text,8) store, count(*)::int n, count(c.id)::int co_gia_thuc, count(*) filter (where c.id is not null and round(c.amount) <> round(l.cost_override * l.quantity))::int lech_voi_thuc, min(o.processed_at_shopify)::date tu, max(o.processed_at_shopify)::date den
     from shopify_order_lines l join shopify_orders o on o.id=l.order_id left join order_line_cogs c on c.order_id=l.order_id and c.shopify_line_id=l.shopify_line_id and c.kind='cogs'
     where l.cost_override is not null group by 1`);
  await q('chi tiết các dòng có override:', `select o.shopify_order_number ma, l.sku, l.quantity q, l.cost_override::text ovr, (l.cost_override*l.quantity)::text ovr_dong, c.amount::text thuc, c.source, c.period, to_char(o.processed_at_shopify + interval '7 hours','YYYY-MM-DD') ngay
     from shopify_order_lines l join shopify_orders o on o.id=l.order_id left join order_line_cogs c on c.order_id=l.order_id and c.shopify_line_id=l.shopify_line_id and c.kind='cogs'
     where l.cost_override is not null order by o.processed_at_shopify desc limit 25`);
  await q('audit ai sửa override (nếu có bảng audit):', `select action, count(*)::int n, max(created_at) gan_nhat from audit_logs where action ilike '%order%' or action ilike '%cost%' group by 1 order by 2 desc limit 8`);
  process.exit(0);
})();
