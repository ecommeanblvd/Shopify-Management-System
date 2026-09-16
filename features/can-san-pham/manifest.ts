import type { FeatureManifest } from '@/lib/registry/registry';

/** Sửa cân biến thể trên Shopify từ đề xuất đã duyệt (CEO 16/09/2026). */
export const productWeightsManifest: FeatureManifest = {
  key: 'product-weights',
  name: 'Sửa cân nặng sản phẩm',
  version: '1.0.0',
  // productVariantsBulkUpdate: "Requires write_products access scope" (Admin API 2025-01).
  requiredScopes: ['write_products'],
  hasWriteOperations: true,
};
