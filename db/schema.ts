import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index, integer, primaryKey, numeric, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  // Brand cost-of-goods accounting can use a different currency than the
  // Shopify store currency — Mirer for example takes USD orders but pays
  // suppliers in VND. When `cost_currency` is set, all COGs numbers
  // (sku_costs rows whose currency matches, plus per-line cost overrides
  // entered against this store) are converted to the order currency at
  // compute time using `fx_cost_per_order_currency`.
  //
  // Semantics: how many `cost_currency` units equal 1 unit of the order
  // currency. For Mirer: cost_currency='VND', fx_cost_per_order_currency
  // = 24000 means 1 USD = 24,000 VND. To translate a VND COGs figure
  // into the USD revenue formula: divide by 24,000.
  costCurrency: text('cost_currency'),
  fxCostPerOrderCurrency: numeric('fx_cost_per_order_currency', { precision: 14, scale: 4 }),
  costFxUpdatedAt: timestamp('cost_fx_updated_at'),
  // Flat per-order packaging fee the operator pays on top of the carrier
  // bill — boxes, dunnage, labels, fulfilment labour. Currently set per
  // store (e.g. $5/order for Mirer). Stored in the order currency so the
  // dashboard can subtract it directly without an FX step.
  packagingFee: numeric('packaging_fee', { precision: 14, scale: 2 }),
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
// FedEx (and likely future carriers) prices Pak (envelope/bag) and Package
// (box) differently for the same destination + weight tier. Per the IPE
// rate sheet, both packaging types are listed; the operator chooses one
// per shipment based on weight (< 2kg = Pak, ≥ 2kg = Package by convention).
export const carrierPackageTypeEnum = pgEnum('carrier_package_type', ['pak', 'package']);

export const carrierRateCells = pgTable('carrier_rate_cells', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierZoneId: uuid('carrier_zone_id').references(() => carrierZones.id, { onDelete: 'cascade' }).notNull(),
  carrierWeightTierId: uuid('carrier_weight_tier_id').references(() => carrierWeightTiers.id, { onDelete: 'cascade' }).notNull(),
  packageType: carrierPackageTypeEnum('package_type').notNull().default('package'),
  costAmount: numeric('cost_amount', { precision: 14, scale: 2 }).notNull(),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Unique per (zone, tier, package_type) — Pak and Package are independent
  // rates for the same destination weight.
  uniqueIndex('carrier_rate_cells_zone_tier_pkg_idx').on(table.carrierZoneId, table.carrierWeightTierId, table.packageType),
]);

export const carrierSurchargeKindEnum = pgEnum('carrier_surcharge_kind', [
  'fuel_percent',
  'peak_fixed',
  'remote_fixed',
  'residential_fixed',
  'markup_percent',
  // Added Phase 2b: per-kg surcharges like DHL GoGreen Plus (SAF) at 3,800 VND/kg.
  'per_kg_fixed',
  // Country/region-scoped per-kg surcharge — e.g. FedEx Demand Surcharge
  // (https://www.fedex.com/en-vn/shipping/surcharges/demand-surcharge.html).
  // Different VND/kg rates per country group; the engine applies the row
  // whose `country_codes` array contains the order's destination country.
  // Multiple rows with overlapping country lists ALL apply (sum), matching
  // FedEx's "two demand surcharges can compound" semantics.
  'demand_per_kg',
  // Country-scoped FLAT per-shipment fee — e.g. FedEx Vietnam "Phí xử lý
  // hàng nhập tại Hoa Kỳ" (US import-handling / Duty Prepaid). Uses the
  // same `country_codes` jsonb scoping as `demand_per_kg`. Folded into the
  // fuelable subtotal so fuel applies on top — invoice math confirms the
  // FedEx behaviour: fuel = 15% × (base + this fee).
  'country_fixed',
  // VAT applied on (base + all surcharges + fuel). FedEx VN charges 8 %
  // (temporarily reduced from 10 %); operators in other jurisdictions can
  // set their own rate. Applied BEFORE markup so markup compounds on the
  // VAT-inclusive carrier bill — matches "I want X % margin on what I pay
  // the carrier" semantics.
  'vat_percent',
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
  // ISO-2 country codes the surcharge applies to. Only meaningful for
  // `demand_per_kg` (FedEx Demand Surcharge). NULL on every other kind and
  // on demand_per_kg rows that should apply globally. Stored as jsonb so a
  // single row can list a whole regional group ("EU+UK" → ['DE','FR','IT',
  // ...]) without an extra join table.
  countryCodes: jsonb('country_codes'),
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
  // Optional per-order weight override. When set, the carrier-engine
  // uses this weight instead of `ship_weight_kg` to look up the rate.
  // Used for legacy orders where the variant weight was wrong at sync
  // time and got snapshot — fixing the variant in Shopify doesn't
  // retroactively update past orders, so the operator points the
  // engine at the correct weight here.
  shipWeightKgOverride: numeric('ship_weight_kg_override', { precision: 10, scale: 3 }),
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

// ─────────────────────────────────────────────────────────────────────
// Functions module — pluggable storefront-side features (wishlist, etc.)
// Each function is registered at code-level (lib/registry/functions.ts)
// and can be enabled/disabled per store via the store_function_settings
// table. Data lives in function-specific tables; only the activation
// flag + per-store config blob is shared.
// ─────────────────────────────────────────────────────────────────────

export const storeFunctionSettings = pgTable('store_function_settings', {
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  functionKey: text('function_key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  /** Function-specific configuration blob (e.g. wishlist accent colour,
   *  email template overrides). Each function defines its own shape. */
  config: jsonb('config'),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.functionKey] }),
]);

// One wishlist per (store, identity). Identity is either an authenticated
// customer's email (preferred — survives device wipes) or a guest
// device id (UUID written to localStorage by the storefront script).
// Multi-store isolation enforced by the partial unique indexes below:
// the same email at meanblvd and mirer are two distinct wishlists.
export const wishlists = pgTable('wishlists', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  customerEmail: text('customer_email'),
  /** Shopify customer GID when the storefront script can resolve it
   *  (logged-in shopper). Helps reconcile with Shopify customer-level
   *  analytics; not the primary identity. */
  shopifyCustomerId: text('shopify_customer_id'),
  /** Random UUID written to localStorage for anonymous shoppers. Merged
   *  into a registered (email-keyed) wishlist on login. */
  deviceId: text('device_id'),
  /** Public, opaque token for /wl/[token] share page. Generated lazily
   *  the first time the shopper hits "Share wishlist". Distinct from the
   *  wishlist id so a leaked token can be rotated without touching the
   *  primary key. */
  shareToken: text('share_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('wishlists_store_email_idx')
    .on(t.storeId, t.customerEmail)
    .where(sql`${t.customerEmail} IS NOT NULL`),
  uniqueIndex('wishlists_store_device_idx')
    .on(t.storeId, t.deviceId)
    .where(sql`${t.deviceId} IS NOT NULL`),
  uniqueIndex('wishlists_share_token_idx')
    .on(t.shareToken)
    .where(sql`${t.shareToken} IS NOT NULL`),
]);

// One row per product (or variant) in a wishlist. We snapshot the
// title/handle/image/price at add-time so the storefront can render the
// wishlist page without a fan-out to Shopify Storefront API. A future
// background job will refresh stale snapshots on price/stock change.
export const wishlistItems = pgTable('wishlist_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  wishlistId: uuid('wishlist_id').references(() => wishlists.id, { onDelete: 'cascade' }).notNull(),
  shopifyProductId: text('shopify_product_id').notNull(),
  shopifyVariantId: text('shopify_variant_id'),
  productTitle: text('product_title').notNull(),
  variantTitle: text('variant_title'),
  productHandle: text('product_handle').notNull(),
  imageUrl: text('image_url'),
  priceAmount: numeric('price_amount', { precision: 14, scale: 2 }),
  priceCurrency: text('price_currency'),
  /** Inventory snapshot from add-time. NULL when the storefront couldn't
   *  determine availability; true/false otherwise. Drives the "Out of
   *  stock" badge in the drawer + public share page. Refreshed lazily
   *  by a future cron — see snapshot-refresh follow-up. */
  availableForSale: boolean('available_for_sale'),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (t) => [
  // Dedup: same product+variant added twice → noop. `COALESCE` so NULL
  // variant ids collapse to a single canonical key.
  uniqueIndex('wishlist_items_dedup_idx')
    .on(t.wishlistId, t.shopifyProductId, sql`COALESCE(${t.shopifyVariantId}, '')`),
  index('wishlist_items_product_idx').on(t.shopifyProductId),
]);

// ─────────────────────────────────────────────────────────────────────
// Gift Registry — share-first wishlist with event metadata and a
// reservation flow so guests can claim items without duplicates.
// Distinct from wishlists because:
//   - every registry is intended to be public (carries a share_token
//     from creation, not generated lazily on the first share click)
//   - items carry a desired-quantity field that reservations decrement
//   - non-owner reservations are first-class rows, not events
// ─────────────────────────────────────────────────────────────────────
export const giftRegistries = pgTable('gift_registries', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  /** Email is REQUIRED — gift registries are inherently shareable and
   *  need a stable owner across devices. Reservations also reach out
   *  to the owner if the future email infra ships. */
  ownerEmail: text('owner_email').notNull(),
  ownerName: text('owner_name'),
  eventName: text('event_name').notNull(),
  /** Optional — open registries (no specific date) are valid too. */
  eventDate: date('event_date'),
  message: text('message'),
  /** Public share token. Generated at creation so the URL is the
   *  registry's primary public identity. Distinct from `id` so a leaked
   *  token can be rotated without touching FKs. */
  shareToken: text('share_token').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('gift_registries_token_idx').on(t.shareToken),
  index('gift_registries_owner_idx').on(t.storeId, t.ownerEmail),
]);

export const giftRegistryItems = pgTable('gift_registry_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  registryId: uuid('registry_id').references(() => giftRegistries.id, { onDelete: 'cascade' }).notNull(),
  shopifyProductId: text('shopify_product_id').notNull(),
  shopifyVariantId: text('shopify_variant_id'),
  productTitle: text('product_title').notNull(),
  variantTitle: text('variant_title'),
  productHandle: text('product_handle').notNull(),
  imageUrl: text('image_url'),
  priceAmount: numeric('price_amount', { precision: 14, scale: 2 }),
  priceCurrency: text('price_currency'),
  /** Desired quantity. Reservations subtract from this. */
  qtyWanted: integer('qty_wanted').notNull().default(1),
  /** Operator / owner notes shown alongside the item ("size 9", "rose
   *  gold preferred"). */
  notes: text('notes'),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (t) => [
  index('gift_registry_items_registry_idx').on(t.registryId),
]);

export const giftRegistryReservations = pgTable('gift_registry_reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  registryId: uuid('registry_id').references(() => giftRegistries.id, { onDelete: 'cascade' }).notNull(),
  itemId: uuid('item_id').references(() => giftRegistryItems.id, { onDelete: 'cascade' }).notNull(),
  reserverName: text('reserver_name').notNull(),
  reserverEmail: text('reserver_email').notNull(),
  qty: integer('qty').notNull().default(1),
  message: text('message'),
  /** 'reserved' until the giver marks it purchased; 'purchased' once
   *  confirmed; 'cancelled' if the giver backs out (kept for audit). */
  status: text('status').notNull().default('reserved'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('gift_registry_reservations_item_idx').on(t.itemId),
  index('gift_registry_reservations_registry_idx').on(t.registryId),
]);

// ─────────────────────────────────────────────────────────────────────
// Recently Viewed — second function in the storefront registry. Logs
// product views per shopper so the embed can render a "Recently
// viewed" carousel on PDPs / cart / collection pages. Append-only;
// deduplication happens at read time so the timestamp on each view
// stays honest (drives a "viewed N times" cohort metric later).
// ─────────────────────────────────────────────────────────────────────
export const recentlyViewedEvents = pgTable('recently_viewed_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  /** Identity columns — same shape as wishlists for consistency. At
   *  least one of email / deviceId is required (enforced by the
   *  storefront action). */
  customerEmail: text('customer_email'),
  shopifyCustomerId: text('shopify_customer_id'),
  deviceId: text('device_id'),
  shopifyProductId: text('shopify_product_id').notNull(),
  shopifyVariantId: text('shopify_variant_id'),
  productTitle: text('product_title').notNull(),
  productHandle: text('product_handle').notNull(),
  imageUrl: text('image_url'),
  priceAmount: numeric('price_amount', { precision: 14, scale: 2 }),
  priceCurrency: text('price_currency'),
  viewedAt: timestamp('viewed_at').defaultNow().notNull(),
}, (t) => [
  // Hot path: list last N for a device/email.
  index('recently_viewed_device_time_idx').on(t.storeId, t.deviceId, t.viewedAt),
  index('recently_viewed_email_time_idx').on(t.storeId, t.customerEmail, t.viewedAt),
  // For top-N-products-viewed analytics.
  index('recently_viewed_product_idx').on(t.storeId, t.shopifyProductId, t.viewedAt),
]);

// Append-only event log for analytics. Every add/remove/share/view is
// written here so the dashboard can compute funnel + cohort metrics
// without scanning the wishlist tables.
export const wishlistEvents = pgTable('wishlist_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  wishlistId: uuid('wishlist_id').references(() => wishlists.id, { onDelete: 'set null' }),
  /** 'add' | 'remove' | 'merge' | 'share' | 'view' — kept as text so new
   *  event types don't need a migration. */
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('wishlist_events_store_created_idx').on(t.storeId, t.createdAt),
]);
