import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index, integer, primaryKey, numeric, date } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export const roleEnum = pgEnum('role', ['admin', 'operator', 'viewer']);
export const storeStatusEnum = pgEnum('store_status', ['active', 'disconnected', 'error']);

export const roles = pgTable('roles', {
  userId: text('user_id').references(() => user.id).primaryKey(),
  role: roleEnum('role').notNull().default('viewer'),
});

export const stores = pgTable('stores', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  shopDomain: text('shop_domain').notNull().unique(),
  plan: text('plan'),
  encryptedToken: text('encrypted_token').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  apiVersion: text('api_version').notNull(),
  status: storeStatusEnum('status').notNull().default('active'),
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
});

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  featureKey: text('feature_key').notNull(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').notNull().default({}),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('feature_flags_feature_key_store_id_idx').on(table.featureKey, table.storeId),
]);

// Read activity — short retention, pruned by a scheduled job.
export const accessLog = pgTable('access_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => user.id),
  storeId: uuid('store_id').references(() => stores.id),
  featureKey: text('feature_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Write/config changes — append-only, retained permanently.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => user.id),
  storeId: uuid('store_id').references(() => stores.id),
  featureKey: text('feature_key'),
  action: text('action').notNull(),
  target: text('target'),
  requestSummary: text('request_summary'),
  result: text('result').notNull(),
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const settingsSnapshots = pgTable('settings_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  domain: text('domain').notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  applyRunId: uuid('apply_run_id').references(() => applyRuns.id),
  capturedAt: timestamp('captured_at').defaultNow().notNull(),
  capturedBy: text('captured_by').references(() => user.id),
}, (table) => [
  index('settings_snapshots_store_domain_captured_idx').on(table.storeId, table.domain, table.capturedAt),
]);

// --- Spec #2: settings-sync tables ---

export const settingDomainEnum = pgEnum('setting_domain', [
  'shipping',
  'checkout_buyer_experience',
]);

export const applyStatusEnum = pgEnum('apply_status', [
  'preview', 'in_progress', 'success', 'partial', 'failed', 'rolled_back',
]);

export const reconciliationStatusEnum = pgEnum('reconciliation_status_enum', [
  'pending', 'reconciled',
]);

export const settingTemplates = pgTable('setting_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  domain: settingDomainEnum('domain').notNull(),
  payload: jsonb('payload').notNull(),
  version: integer('version').notNull(),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('setting_templates_domain_version_idx').on(table.domain, table.version),
]);

export const settingOverrides = pgTable('setting_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  domain: settingDomainEnum('domain').notNull(),
  path: text('path').notNull(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('setting_overrides_store_domain_path_idx').on(table.storeId, table.domain, table.path),
]);

export const applyRuns = pgTable('apply_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('template_id').references(() => settingTemplates.id).notNull(),
  domain: settingDomainEnum('domain').notNull(),
  targetStoreIds: uuid('target_store_ids').array().notNull(),
  status: applyStatusEnum('status').notNull().default('preview'),
  startedBy: text('started_by').references(() => user.id),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
  summary: jsonb('summary').notNull().default({}),
  parentRunId: uuid('parent_run_id'),
});

export const reconciliationStatus = pgTable('reconciliation_status', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  domain: settingDomainEnum('domain').notNull(),
  status: reconciliationStatusEnum('status').notNull().default('pending'),
  reconciledAt: timestamp('reconciled_at'),
  reconciledBy: text('reconciled_by').references(() => user.id),
}, (table) => [
  uniqueIndex('reconciliation_status_store_domain_idx').on(table.storeId, table.domain),
]);

// --- Markets feature tables ---

export const marketTypeEnum = pgEnum('market_type', ['regional', 'international']);

// Markets apply uses its own status enum (separate from settings-sync apply_runs).
// 'partial_error' is more descriptive than the parallel 'partial' value.
// 'rolled_back' is intentionally absent — spec scope is manual rollback only
// (snapshots in market_apply_history give enough data for offline restore).
export const marketApplyStatusEnum = pgEnum('market_apply_status', [
  'preview', 'in_progress', 'success', 'partial_error', 'failed',
]);

export const marketTemplates = pgTable('market_templates', {
  handle: text('handle').primaryKey(),
  name: text('name').notNull(),
  type: marketTypeEnum('type').notNull(),
  countries: jsonb('countries').notNull().default([]),
  primaryCurrency: text('primary_currency').notNull(),
  alternativeCurrencies: jsonb('alternative_currencies').notNull().default([]),
  primaryLanguage: text('primary_language').notNull(),
  alternativeLanguages: jsonb('alternative_languages').notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const marketStoreOverrides = pgTable('market_store_overrides', {
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  marketHandle: text('market_handle').references(() => marketTemplates.handle, { onUpdate: 'cascade' }).notNull(),
  priceAdjustment: jsonb('price_adjustment'),
  shipping: jsonb('shipping'),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.marketHandle] }),
]);

export const marketApplyHistory = pgTable('market_apply_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  marketHandle: text('market_handle'),
  userId: text('user_id').references(() => user.id),
  action: text('action').notNull(),
  status: marketApplyStatusEnum('status').notNull(),
  diff: jsonb('diff'),
  preSnapshot: jsonb('pre_snapshot'),
  postSnapshot: jsonb('post_snapshot'),
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('market_apply_history_store_created_idx').on(table.storeId, table.createdAt),
]);

// --- Carrier Rates feature (spec 2026-05-25) ---

// Top-level carrier brand. Seed: dhl, fedex. Add more carriers without code.
export const carriers = pgTable('carriers', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const carrierWeightUnitEnum = pgEnum('carrier_weight_unit', ['kg', 'lb']);

// One contract per row. Operators may have multiple per carrier.
export const carrierAccounts = pgTable('carrier_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierId: uuid('carrier_id').references(() => carriers.id, { onDelete: 'restrict' }).notNull(),
  name: text('name').notNull(),
  weightUnit: carrierWeightUnitEnum('weight_unit').notNull().default('kg'),
  costCurrency: text('cost_currency').notNull(),
  displayCurrency: text('display_currency').notNull(),
  // fx_cost_per_display: how many cost-currency units equal one display-currency unit.
  // For VND cost / USD display, value is e.g. 26000 (1 USD = 26 000 VND).
  fxCostPerDisplay: numeric('fx_cost_per_display', { precision: 14, scale: 4 }).notNull(),
  fxUpdatedAt: timestamp('fx_updated_at').defaultNow().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  notes: text('notes'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const carrierZones = pgTable('carrier_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  position: integer('position').notNull().default(0),
}, (table) => [
  uniqueIndex('carrier_zones_account_label_idx').on(table.carrierAccountId, table.label),
]);

// Country lives in exactly one zone per account.
export const carrierZoneCountries = pgTable('carrier_zone_countries', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  carrierZoneId: uuid('carrier_zone_id').references(() => carrierZones.id, { onDelete: 'cascade' }).notNull(),
  countryCode: text('country_code').notNull(),
}, (table) => [
  uniqueIndex('carrier_zone_countries_account_country_idx').on(table.carrierAccountId, table.countryCode),
  index('carrier_zone_countries_zone_idx').on(table.carrierZoneId),
]);

// Tier price covers weights in (previous.upperKg, this.upperKg]. Highest tier = ∞.
export const carrierWeightTiers = pgTable('carrier_weight_tiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  upperKg: numeric('upper_kg', { precision: 8, scale: 3 }).notNull(),
  position: integer('position').notNull().default(0),
}, (table) => [
  uniqueIndex('carrier_weight_tiers_account_upper_idx').on(table.carrierAccountId, table.upperKg),
]);

// Rate matrix cell. Cost is in account.costCurrency.
export const carrierRateCells = pgTable('carrier_rate_cells', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierZoneId: uuid('carrier_zone_id').references(() => carrierZones.id, { onDelete: 'cascade' }).notNull(),
  carrierWeightTierId: uuid('carrier_weight_tier_id').references(() => carrierWeightTiers.id, { onDelete: 'cascade' }).notNull(),
  costAmount: numeric('cost_amount', { precision: 14, scale: 2 }).notNull(),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('carrier_rate_cells_zone_tier_idx').on(table.carrierZoneId, table.carrierWeightTierId),
]);

export const carrierSurchargeKindEnum = pgEnum('carrier_surcharge_kind', [
  'fuel_percent',
  'peak_fixed',
  'remote_fixed',
  'residential_fixed',
  'markup_percent',
  // Added Phase 2b: per-kg surcharges like DHL GoGreen Plus (SAF) at 3,800 VND/kg.
  'per_kg_fixed',
]);

export const carrierSurcharges = pgTable('carrier_surcharges', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  kind: carrierSurchargeKindEnum('kind').notNull(),
  value: numeric('value', { precision: 14, scale: 4 }).notNull(),
  // Optional per-kg companion: when set, the surcharge applies max(value,
  // value_per_kg × weightKg) instead of just `value`. Used by FedEx ODA Tier
  // B/C which charge "550,000 VND per shipment OR 9,200 VND per kg, whichever
  // is HIGHER". Only meaningful for remote_fixed and similar floor-style kinds.
  valuePerKg: numeric('value_per_kg', { precision: 14, scale: 4 }),
  // Optional tier label (e.g. 'Tier A', 'Tier B') so remote_fixed surcharges
  // can apply only to postcodes carrying that tier. NULL means catch-all.
  tier: text('tier'),
  active: boolean('active').notNull().default(true),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  note: text('note'),
  updatedBy: text('updated_by').references(() => user.id),
  // Bookkeeping for auto-refresh (e.g. FedEx weekly fuel surcharge scraper).
  // Lets the UI display "Last auto-refreshed Xh ago" and distinguish operator
  // edits from cron writes without bloating the row with an audit log.
  lastAutoFetchedAt: timestamp('last_auto_fetched_at'),
  lastAutoSource: text('last_auto_source'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('carrier_surcharges_account_kind_idx').on(table.carrierAccountId, table.kind),
]);

export const carrierRemotePostcodes = pgTable('carrier_remote_postcodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  countryCode: text('country_code').notNull(),
  postcodePattern: text('postcode_pattern').notNull(),
  // FedEx ODA tiers are 'Tier A' / 'Tier B' / 'Tier C'. Carrier-agnostic free
  // text so future carriers (UPS, DPD) can use their own labels.
  tier: text('tier'),
  source: text('source'),
  uploadedBy: text('uploaded_by').references(() => user.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('carrier_remote_postcodes_account_country_pattern_idx')
    .on(table.carrierAccountId, table.countryCode, table.postcodePattern),
  index('carrier_remote_postcodes_lookup_idx').on(table.carrierAccountId, table.countryCode),
]);

// Link table: which carrier account serves which market.
export const marketCarrierLinks = pgTable('market_carrier_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  marketHandle: text('market_handle')
    .references(() => marketTemplates.handle, { onUpdate: 'cascade', onDelete: 'cascade' })
    .notNull(),
  carrierAccountId: uuid('carrier_account_id')
    .references(() => carrierAccounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceLabel: text('service_label').notNull(),
  position: integer('position').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('market_carrier_links_market_account_idx').on(table.marketHandle, table.carrierAccountId),
]);

// Audit log of every quote produced.
export const carrierQuoteLogContextEnum = pgEnum('carrier_quote_context', ['calculator', 'push_recalc']);

export const carrierQuoteLogs = pgTable('carrier_quote_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  destinationCountry: text('destination_country').notNull(),
  destinationPostcode: text('destination_postcode'),
  weightKg: numeric('weight_kg', { precision: 8, scale: 3 }).notNull(),
  breakdown: jsonb('breakdown').notNull(),
  context: carrierQuoteLogContextEnum('context').notNull(),
  computedBy: text('computed_by').references(() => user.id),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (table) => [
  index('carrier_quote_logs_account_computed_idx').on(table.carrierAccountId, table.computedAt),
]);

export * from './auth-schema';

// ──────────────────────────────────────────────────────────────────────────
// Shopify orders (spec: docs/superpowers/specs/2026-05-28-shopify-orders-design.md)
// ──────────────────────────────────────────────────────────────────────────

export const shopifyOrders = pgTable('shopify_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyOrderId: text('shopify_order_id').notNull().unique(),
  shopifyOrderNumber: text('shopify_order_number').notNull(),
  createdAtShopify: timestamp('created_at_shopify').notNull(),
  processedAtShopify: timestamp('processed_at_shopify').notNull(),
  cancelledAtShopify: timestamp('cancelled_at_shopify'),
  financialStatus: text('financial_status').notNull(),
  fulfillmentStatus: text('fulfillment_status'),
  currency: text('currency').notNull(),
  // grossLineTotal = Σ(originalUnitPrice × qty), pre-any-discount; this is GMV.
  grossLineTotal: numeric('gross_line_total', { precision: 14, scale: 2 }).notNull(),
  // totalDiscount maps Shopify's totalDiscountsSet — covers line + order discounts combined.
  totalDiscount: numeric('total_discount', { precision: 14, scale: 2 }).notNull(),
  totalShipping: numeric('total_shipping', { precision: 14, scale: 2 }).notNull(),
  totalTax: numeric('total_tax', { precision: 14, scale: 2 }).notNull(),
  totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
  shipCountry: text('ship_country'),
  shipWeightKg: numeric('ship_weight_kg', { precision: 10, scale: 3 }),
  rawPayload: jsonb('raw_payload').notNull(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  source: text('source').notNull(),
  // Optional per-order shipping cost override. When set, takes precedence
  // over both `shipping_invoices` actuals AND the carrier-engine estimate
  // — operators use this when they know the real shipping bill for an
  // individual order before/instead of the invoice arriving (e.g. one-off
  // courier, free shipping promo, comped order).
  shippingCostOverride: numeric('shipping_cost_override', { precision: 14, scale: 2 }),
  shippingCostOverrideNote: text('shipping_cost_override_note'),
}, (t) => [
  index('shopify_orders_store_processed_idx').on(t.storeId, t.processedAtShopify),
  index('shopify_orders_cancelled_idx').on(t.cancelledAtShopify),
]);

export const shopifyOrderLines = pgTable('shopify_order_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyLineId: text('shopify_line_id').notNull(),
  sku: text('sku'),
  vendor: text('vendor'),
  productTitle: text('product_title').notNull(),
  variantTitle: text('variant_title'),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  discountAlloc: numeric('discount_alloc', { precision: 14, scale: 2 }).notNull(),
  total: numeric('total', { precision: 14, scale: 2 }).notNull(),
  // Optional per-line COGs override. When set, takes precedence over the
  // sku_costs lookup. Same per-unit precision as sku_costs.cost_per_unit.
  costOverride: numeric('cost_override', { precision: 14, scale: 4 }),
}, (t) => [
  index('shopify_order_lines_order_idx').on(t.orderId),
  index('shopify_order_lines_sku_idx').on(t.sku),
  index('shopify_order_lines_vendor_idx').on(t.vendor),
]);

export const shopifyOrderRefunds = pgTable('shopify_order_refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyRefundId: text('shopify_refund_id').notNull().unique(),
  refundedAt: timestamp('refunded_at').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  reason: text('reason'),
}, (t) => [
  index('shopify_order_refunds_order_idx').on(t.orderId),
  index('shopify_order_refunds_refunded_at_idx').on(t.refundedAt),
]);

export const skuCosts = pgTable('sku_costs', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  sku: text('sku').notNull(),
  costPerUnit: numeric('cost_per_unit', { precision: 14, scale: 4 }).notNull(),
  currency: text('currency').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  source: text('source').notNull(),
  uploadedBy: text('uploaded_by').references(() => user.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('sku_costs_store_sku_from_idx').on(t.storeId, t.sku, t.effectiveFrom),
  index('sku_costs_lookup_idx').on(t.storeId, t.sku, t.effectiveFrom),
]);

export const shippingInvoices = pgTable('shipping_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id).notNull(),
  trackingNumber: text('tracking_number').notNull(),
  invoicePeriodStart: date('invoice_period_start').notNull(),
  invoicePeriodEnd: date('invoice_period_end').notNull(),
  actualCost: numeric('actual_cost', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  source: text('source').notNull(),
}, (t) => [
  uniqueIndex('shipping_invoices_store_tracking_idx').on(t.storeId, t.trackingNumber),
  index('shipping_invoices_carrier_period_idx').on(t.carrierAccountId, t.invoicePeriodStart),
]);

export const shopifySyncState = pgTable('shopify_sync_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull().unique(),
  backfillStatus: text('backfill_status').notNull().default('idle'),
  backfillCursor: text('backfill_cursor'),
  backfillStartedAt: timestamp('backfill_started_at'),
  backfillFinishedAt: timestamp('backfill_finished_at'),
  backfillError: text('backfill_error'),
  lastWebhookAt: timestamp('last_webhook_at'),
  lastCronSyncAt: timestamp('last_cron_sync_at'),
  lastCronCursor: text('last_cron_cursor'),
});

export const shopifyWebhookLog = pgTable('shopify_webhook_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),
  shopifyWebhookId: text('shopify_webhook_id').notNull().unique(),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
  status: text('status').notNull(),
  error: text('error'),
  payloadHash: text('payload_hash').notNull(),
}, (t) => [
  index('shopify_webhook_log_store_received_idx').on(t.storeId, t.receivedAt),
]);
