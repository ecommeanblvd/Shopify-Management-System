-- Wishlist Page hotfix (2026-07-05): chuẩn hóa product-id về numeric để khớp
-- format theme embed gửi lên (ShopifyAnalytics.meta.product.id là số trần,
-- KHÔNG phải GID). shopify_products đang lưu GID (từ Admin GraphQL p.id) —
-- strip prefix. Deterministic, không đụng độ (unique (store_id, shopify_product_id)
-- vẫn giữ nguyên).
UPDATE shopify_products
SET shopify_product_id = replace(shopify_product_id, 'gid://shopify/Product/', '')
WHERE shopify_product_id LIKE 'gid://shopify/Product/%';

-- 2 wishlist_items seed thủ công mang GID format (seed từ catalog cũ) — chuẩn
-- hóa luôn để nhất quán với theme + catalog đã normalize ở trên.
UPDATE wishlist_items
SET shopify_product_id = replace(shopify_product_id, 'gid://shopify/Product/', '')
WHERE shopify_product_id LIKE 'gid://shopify/Product/%';
