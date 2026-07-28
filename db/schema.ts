import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index, integer, primaryKey, numeric, date, check, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth-schema';

export const roleEnum = pgEnum('role', ['admin', 'operator', 'viewer']);
export const storeStatusEnum = pgEnum('store_status', ['active', 'disconnected', 'error']);
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'revoked']);

export const appRoles = pgTable('app_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  roleId: uuid('role_id').references(() => appRoles.id, { onDelete: 'cascade' }).notNull(),
  permissionKey: text('permission_key').notNull(),
}, (t) => [uniqueIndex('role_permissions_role_key_idx').on(t.roleId, t.permissionKey)]);

export const roles = pgTable('roles', {
  userId: text('user_id').references(() => user.id).primaryKey(),
  role: roleEnum('role').notNull().default('viewer'),
  roleId: uuid('role_id').references(() => appRoles.id),
});

export const userInvites = pgTable('user_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  roleId: uuid('role_id').references(() => appRoles.id, { onDelete: 'set null' }),
  invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  status: inviteStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at'),
  acceptedUserId: text('accepted_user_id').references(() => user.id, { onDelete: 'set null' }),
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

export const manualShippingConfig = pgTable('manual_shipping_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  marketHandle: text('market_handle').notNull().unique(),
  shipping: jsonb('shipping').notNull(),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
  // Precision (20,10) so the inverse direction also fits: USD cost / VND display
  // needs fx = 1/26000 ≈ 0.0000384615 (Aramex — rate sheet in USD, displayed VND).
  fxCostPerDisplay: numeric('fx_cost_per_display', { precision: 20, scale: 10 }).notNull(),
  fxUpdatedAt: timestamp('fx_updated_at').defaultNow().notNull(),
  // Volumetric divisor in cm³/kg for chargeable-weight calc:
  //   dimWeightKg = L_cm × W_cm × H_cm / dimDivisorCm3PerKg
  //   chargeableKg = max(actualKg, dimWeightKg)
  // FedEx & DHL air freight publish 5000; ground/road can be 6000.
  // NULL means "skip dim-weight entirely" (engine just uses actual).
  dimDivisorCm3PerKg: numeric('dim_divisor_cm3_per_kg', { precision: 8, scale: 2 }).default('5000'),
  // Per-carrier rounding step applied to chargeable weight before the
  // weight-tier lookup. NULL = use the raw computed value (DHL default —
  // raw chargeable 2.52 kg → tier 3 kg). Set to 0.5 for FedEx which
  // rounds to NEAREST 0.5 kg before tier lookup (chargeable 2.52 →
  // 2.5 → tier 2.5; verified on 2026-06-03 across 15+ invoices).
  chargeableRoundingKg: numeric('chargeable_rounding_kg', { precision: 6, scale: 3 }),
  // NULL → FedEx 2-step (0.1 pre-round rồi ceil); 'ceil' → DHL ceil thẳng.
  chargeableRoundingMode: text('chargeable_rounding_mode'),
  // NULL → làm tròn 1 lần ở tổng (legacy); 'per_line' → tròn từng dòng rồi
  // cộng (quy ước hóa đơn FedEx — đo 2.400+ dòng). DHL chờ confirm.
  totalsRoundingMode: text('totals_rounding_mode'),
  enabled: boolean('enabled').notNull().default(true),
  // Tạm ngưng CHỌN (outbound): vẫn báo giá để so sánh, nhưng staff không chọn
  // được carrier này khi suspended_at ≤ hiện tại. KHÁC enabled (enabled=false là
  // ẩn hẳn khỏi hệ thống). suspend_reason hiển thị lý do.
  suspendedAt: timestamp('suspended_at'),
  suspendReason: text('suspend_reason'),
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

// One base-rate sheet with an effective window. A carrier account can have
// several over time (2025 card, 2026 card…). Reconciliation picks the card
// whose [effectiveFrom, effectiveTo] covers a shipment's ship date; the
// calculator/push always use the open card (effectiveTo IS NULL).
export const carrierRateCards = pgTable('carrier_rate_cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id')
    .references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  // Inclusive lower bound.
  effectiveFrom: date('effective_from').notNull(),
  // Inclusive upper bound; NULL = open-ended "current" card. App logic keeps
  // at most one open card per account and forbids overlapping windows.
  effectiveTo: date('effective_to'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Source rate-sheet PDF kept as evidence in R2 (NULL for the migrated card).
  sourcePdfKey: text('source_pdf_key'),
  sourcePdfFilename: text('source_pdf_filename'),
  sourcePdfUploadedAt: timestamp('source_pdf_uploaded_at'),
}, (t) => [
  index('carrier_rate_cards_account_idx').on(t.carrierAccountId),
]);

export const carrierRateCells = pgTable('carrier_rate_cells', {
  id: uuid('id').defaultRandom().primaryKey(),
  rateCardId: uuid('rate_card_id')
    .references(() => carrierRateCards.id, { onDelete: 'cascade' }).notNull(),
  carrierZoneId: uuid('carrier_zone_id').references(() => carrierZones.id, { onDelete: 'cascade' }).notNull(),
  carrierWeightTierId: uuid('carrier_weight_tier_id').references(() => carrierWeightTiers.id, { onDelete: 'cascade' }).notNull(),
  packageType: carrierPackageTypeEnum('package_type').notNull().default('package'),
  costAmount: numeric('cost_amount', { precision: 14, scale: 2 }).notNull(),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Unique per (card, zone, tier, package_type) — Pak and Package are
  // independent rates for the same destination weight, per rate card.
  uniqueIndex('carrier_rate_cells_card_zone_tier_pkg_idx')
    .on(table.rateCardId, table.carrierZoneId, table.carrierWeightTierId, table.packageType),
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
  // Stepped per-weight surcharge — e.g. DHL GoGreen Plus invoices as
  // 1,900 VND × ceil(weight / 0.5 kg). The engine applies
  // `ceil(weightKg / step_kg) × value`. Different from `per_kg_fixed`
  // (which scales linearly). Default `fuelable = false`.
  'per_step_fixed',
  // Negotiated volume discount applied to the published base rate (FedEx
  // "Total Discount" line on invoices). `value` is a PERCENTAGE (e.g. 70
  // means 70 % off base). Engine computes `discountAmount = base × value
  // / 100` and subtracts it from the VATable subtotal (so VAT applies on
  // the discounted total, matching the invoice math we verified on
  // 2026-06-03). Per-zone variation is supported via `country_codes`
  // (US-bound vs SA-bound contracts often have different discount %).
  // NEVER fuelable — fuel% is published by the carrier on the published
  // base, not the discounted base.
  'contract_discount_pct',
  // Dịch vụ bổ sung cố định/lô hàng (Direct Signature DHL/FedEx).
  // apply_mode quyết định: 'always' cộng vào quote; 'when_billed' chỉ là
  // giá tham chiếu cho đối soát.
  'addon_fixed',
  // Phí đóng gói cố định mỗi lô — LƯU Ở ĐƠN VỊ HIỂN THỊ (USD), KHÁC các phí cố
  // định khác (lưu VND chi phí). Engine quy đổi sang VND rồi cộng TRƯỚC markup
  // (markup nhân lên cả packaging). KHÔNG phải cước carrier → KHÔNG vào
  // carrierCost. Thay cho khoản $5 trước đây hardcode ở giá MANUAL; nay áp cho
  // cả engine (live) lẫn manual.
  'packaging_fixed',
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
  // Danh sách nước MIỄN (ISO-2, jsonb) — dòng surcharge KHÔNG áp dụng khi
  // nước đích nằm trong danh sách. NULL = không miễn nước nào. Đối ngẫu với
  // countryCodes (danh sách BAO GỒM); nếu có cả hai, exclusion thắng.
  // Dùng đầu tiên cho FedEx Direct Signature (13 nước miễn, spec 2026-06-11).
  excludedCountryCodes: jsonb('excluded_country_codes'),
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
  // Weight step in kg for `per_step_fixed` surcharges (NULL on every
  // other kind). Engine applies `ceil(weightKg / stepKg) × value`.
  stepKg: numeric('step_kg', { precision: 10, scale: 3 }),
  // Ngưỡng cân (kg) cho per_step_fixed: cân < step_floor_kg → tính 1 bước phẳng
  // (value); cân ≥ ngưỡng → ceil(cân/step_kg)×value. NULL = luôn nhảy bước.
  // DHL GoGreen trước 29/9/2025: 0–1.5kg phẳng 1.900, từ 2kg nhảy (stepFloor 2.0).
  stepFloorKg: numeric('step_floor_kg', { precision: 10, scale: 3 }),
  // Per-row override for whether this surcharge is included in the
  // fuelable subtotal (i.e. fuel% applies on top of it).
  //   NULL  → use the per-kind default (see engine quote.ts isFuelable)
  //   TRUE  → force into fuelable subtotal
  //   FALSE → exclude from fuelable subtotal
  // Needed because the same kind can be fuelable for one carrier and
  // not for another. Example: DHL Elevated Risk is `country_fixed` AND
  // fuelable=true (fuel applies to base + elevated risk per invoice);
  // FedEx VN US-import-handling is also `country_fixed` but
  // fuelable=false (per #MBLVD28990 invoice).
  fuelable: boolean('fuelable'),
  // Per-row VAT override:
  //   NULL  → vatable (VAT covers the whole carrier bill — default)
  //   FALSE → excluded from the VAT base; the amount still reaches the
  //           total. Models flat pass-through fees billed without VAT,
  //           e.g. DHL's retroactive Elevated Risk supplementary bill
  //           for pre-2026-03-04 shipments (ER only, no fuel, no VAT).
  vatable: boolean('vatable'),
  // Chế độ áp dụng — chỉ có nghĩa với kind='addon_fixed':
  //   'always'      → engine cộng vào mọi quote (DHL Direct Signature).
  //   'when_billed' → KHÔNG vào quote; đối soát dùng làm giá tham chiếu
  //                   kiểm khi bill có dòng này (FedEx Direct Signature).
  applyMode: text('apply_mode').notNull().default('always'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // $onUpdate bumps on every Drizzle .update() → reconcile cache auto-busts
  // (latestConfigVersion reads MAX(updated_at)). Insert gets defaultNow.
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index('carrier_surcharges_account_kind_idx').on(table.carrierAccountId, table.kind),
]);

// Khung fuel mà bảng giá MANUAL đã được sinh ra (1 dòng / carrier account).
// Engine vẫn dùng fuel LIVE; manual ghim theo mốc-giữa khung 5% để giá ổn định
// — chỉ sinh lại khi fuel live nhảy sang khung khác (storedMid !== liveMid).
export const manualPricingState = pgTable('manual_pricing_state', {
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).primaryKey(),
  fuelBandMid: numeric('fuel_band_mid', { precision: 6, scale: 2 }).notNull(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
});

export const carrierRemotePostcodes = pgTable('carrier_remote_postcodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  countryCode: text('country_code').notNull(),
  postcodePattern: text('postcode_pattern').notNull(),
  // FedEx ODA tiers are 'Tier A' / 'Tier B' / 'Tier C'. Carrier-agnostic free
  // text so future carriers (UPS, DPD) can use their own labels.
  tier: text('tier'),
  // Remote/ODA lists đổi theo KỲ (FedEx ODA Jan-2025 ≠ Jan-2026…). Engine chọn
  // list phủ NGÀY SHIP của đơn (effective_from ≤ ship < effective_to), giống rate
  // card. effective_to NULL = kỳ hiện hành (mở). Data cũ backfill 2025-01-01 → ∞
  // để không đổi hành vi; import theo năm sẽ cắt cửa sổ đúng kỳ.
  effectiveFrom: date('effective_from').notNull().default('2025-01-01'),
  effectiveTo: date('effective_to'),
  source: text('source'),
  uploadedBy: text('uploaded_by').references(() => user.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('carrier_remote_postcodes_account_country_pattern_from_idx')
    .on(table.carrierAccountId, table.countryCode, table.postcodePattern, table.effectiveFrom),
  index('carrier_remote_postcodes_lookup_idx').on(table.carrierAccountId, table.countryCode),
]);

/**
 * Source-file evidence for a remote/ODA/RAL list import. The postcode rows
 * themselves only carry a `source` text label; this table keeps the actual
 * published file (FedEx ODA xlsx, DHL Remote Area List PDF, rate-surcharge
 * sheet…) in object storage so the import can be audited / disputed against the
 * original. One row per uploaded file, tagged with the period it documents.
 */
export const carrierRemoteEvidence = pgTable('carrier_remote_evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  /** Human label, ideally matching the rows' `source` (e.g. "DHL Remote Areas 2025"). */
  label: text('label').notNull(),
  /** Period this file documents — mirrors the postcode rows' effective window. */
  effectiveFrom: date('effective_from'),
  effectiveTo: date('effective_to'),
  /** Object-storage key (R2/S3) + original filename for download. */
  fileKey: text('file_key').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type'),
  byteSize: integer('byte_size'),
  uploadedBy: text('uploaded_by').references(() => user.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  index('carrier_remote_evidence_account_idx').on(table.carrierAccountId),
]);

/**
 * Carrier accounts-payable: a carrier's periodic invoice (statement) covering
 * many shipments. The original invoice file is kept in object storage as
 * evidence. Outstanding debt = amount − Σ payments. Independent of the
 * per-shipment reconcile — the UI shows the system's recorded total for the
 * same period alongside, for a statement-vs-lines sanity check.
 */
export const carrierBills = pgTable('carrier_bills', {
  id: uuid('id').defaultRandom().primaryKey(),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id, { onDelete: 'cascade' }).notNull(),
  /** Carrier's invoice/statement number. */
  billNumber: text('bill_number'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  issueDate: date('issue_date'),
  /** Payment due date — drives the overdue flag. */
  dueDate: date('due_date'),
  /** Total the carrier billed for the period, in `currency`. */
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  /** Original invoice file in object storage (R2). */
  fileKey: text('file_key'),
  filename: text('filename'),
  contentType: text('content_type'),
  byteSize: integer('byte_size'),
  /** PDF hoá đơn carrier — cột RIÊNG, không ghi đè fileKey (file nguồn CSV/XLSX). */
  pdfFileKey: text('pdf_file_key'),
  pdfFilename: text('pdf_filename'),
  pdfContentType: text('pdf_content_type'),
  pdfByteSize: integer('pdf_byte_size'),
  /** Tổng tiền + ngày đọc từ PDF hoá đơn (mảng C) — để đối soát với amount/issueDate/dueDate (từ XLSX). */
  pdfAmount: numeric('pdf_amount', { precision: 14, scale: 2 }),
  pdfIssueDate: date('pdf_issue_date'),
  pdfDueDate: date('pdf_due_date'),
  note: text('note'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('carrier_bills_account_idx').on(table.carrierAccountId),
]);

/** A payment made against a carrier bill (partial payments allowed). The
 *  payment proof file is kept in object storage. */
export const carrierBillPayments = pgTable('carrier_bill_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  billId: uuid('bill_id').references(() => carrierBills.id, { onDelete: 'cascade' }).notNull(),
  paidAt: date('paid_at').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  method: text('method'),
  /** Payment proof (bank transfer receipt…) in object storage (R2). */
  proofFileKey: text('proof_file_key'),
  proofFilename: text('proof_filename'),
  proofContentType: text('proof_content_type'),
  proofByteSize: integer('proof_byte_size'),
  note: text('note'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('carrier_bill_payments_bill_idx').on(table.billId),
]);

/**
 * Per-shipment line items of a carrier bill, parsed from the uploaded invoice
 * file (PDF/Excel). One row = one tracking number on the statement with its
 * cost breakdown. Populated by the bill parser; the invoice-detail modal reads
 * from here. Empty until a bill is parsed.
 */
export const carrierBillLines = pgTable('carrier_bill_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  billId: uuid('bill_id').references(() => carrierBills.id, { onDelete: 'cascade' }).notNull(),
  trackingNumber: text('tracking_number'),
  orderNumber: text('order_number'),
  weightKg: numeric('weight_kg', { precision: 10, scale: 3 }),
  base: numeric('base', { precision: 14, scale: 2 }),
  discount: numeric('discount', { precision: 14, scale: 2 }),
  fuel: numeric('fuel', { precision: 14, scale: 2 }),
  remote: numeric('remote', { precision: 14, scale: 2 }),
  demand: numeric('demand', { precision: 14, scale: 2 }),
  signature: numeric('signature', { precision: 14, scale: 2 }),
  vat: numeric('vat', { precision: 14, scale: 2 }),
  other: numeric('other', { precision: 14, scale: 2 }),
  // Phí sửa địa chỉ (Address Correction) — FedEx áp CẢ fuel lên khoản này
  // (kiểm chứng bill 734105850: fuel = 38.25% × (freight + AC)).
  addressCorrection: numeric('address_correction', { precision: 14, scale: 2 }),
  // Tách từ 'other' (21/07): phí xử lý hàng NK (68.300/64.500/35.500 theo kỳ —
  // pass-through, KHÔNG fuel, CÓ VAT) và thuế/hải quan duty (pass-through thuần,
  // KHÔNG fuel KHÔNG VAT). 'other' chỉ còn nhãn chưa phân loại.
  importHandling: numeric('import_handling', { precision: 14, scale: 2 }),
  duty: numeric('duty', { precision: 14, scale: 2 }),
  total: numeric('total', { precision: 14, scale: 2 }),
  // Breakdown chi tiết từng khoản phí của carrier (DHL: [{code,name,charge,tax,total}]).
  // Null cho dòng nhập tay/cũ → UI fallback về cột gộp base/fuel/other.
  charges: jsonb('charges'),
  // Ngày đi hàng (Shipment Date của hoá đơn). Khi đối soát, dùng để điền
  // shipments.label_created_at nếu shipment chưa có → Order hiển thị ngày đi hàng.
  shipDate: date('ship_date'),
  // FK ổn định tới shipment đã khớp (theo tracking + mã đơn). Dùng để đẩy billed
  // cước vào đối soát; đổi text tracking/đơn vẫn giữ liên kết. NULL = chưa khớp.
  shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
  // POD từ bill FBO — bằng chứng giao hàng chính thức của FedEx (ngày giờ + người ký).
  podAt: timestamp('pod_at'),
  podName: text('pod_name'),
  // Dòng bill là cước HÀNG HOÀN → FK về đơn gốc (nhận diện từ orderRef "_R"/"RETURN OF").
  returnOfOrderId: uuid('return_of_order_id').references(() => shopifyOrders.id, { onDelete: 'set null' }),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('carrier_bill_lines_bill_idx').on(table.billId),
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
  /** Phí transaction (payment processing + FX) quy về đồng ĐƠN. null khi chưa sync / Shopify không trả fee. */
  transactionFee: numeric('transaction_fee', { precision: 14, scale: 2 }),
  /** Phí ở đồng gốc payout (SGD/SAR/EUR…) để đối chiếu. */
  transactionFeeNative: numeric('transaction_fee_native', { precision: 14, scale: 2 }),
  transactionFeeNativeCurrency: text('transaction_fee_native_currency'),
  shipCountry: text('ship_country'),
  // City + postcode from Shopify shippingAddress, used by the carrier
  // engine to look up remote-area surcharges. Either can be null —
  // postcode-only countries (DE, NL) and city-only countries
  // (SA, KW, OM, AE, QA, BH) both work because the engine falls back
  // between the two keys against the same normalised lookup map.
  shipCity: text('ship_city'),
  shipPostcode: text('ship_postcode'),
  // Địa chỉ đầy đủ người nhận (street/bang/tên) — để verify qua FedEx Address
  // Validation. Trước đây sync tối giản chỉ city/zip; nay kéo đủ để xác minh.
  shipAddress1: text('ship_address1'),
  shipAddress2: text('ship_address2'),
  shipProvinceCode: text('ship_province_code'),
  // Carrier logistic staff CHỌN để đi hàng (quyết định outbound) — KHÁC
  // shipping_carrier_key (carrier khách trả, sync re-derive mỗi lần). Sync
  // KHÔNG đụng 3 cột này.
  selectedCarrierKey: text('selected_carrier_key'),
  selectedCarrierAt: timestamp('selected_carrier_at'),
  selectedCarrierBy: text('selected_carrier_by'),
  shipName: text('ship_name'),
  shipCompany: text('ship_company'),
  // Kết quả verify FedEx Address Validation: phân loại + giao được + vấn đề.
  addrClass: text('addr_class'),               // RESIDENTIAL/BUSINESS/MIXED/UNKNOWN
  addrDeliverable: boolean('addr_deliverable'), // FedEx chuẩn hoá/khớp được (giao được)
  addrIssue: text('addr_issue'),               // vd SuiteRequiredButMissing / NOTFOUND
  addrStandardized: text('addr_standardized'), // địa chỉ chuẩn hoá FedEx gợi ý
  addrVerifiedAt: timestamp('addr_verified_at'),
  addrConfidence: text('addr_confidence'), // verified|census_verified|zip_only|undeliverable (4 mức UI)
  shipWeightKg: numeric('ship_weight_kg', { precision: 10, scale: 3 }),
  rawPayload: jsonb('raw_payload').notNull(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  // Shopify updated_at (last-updated thật) + phát hiện sửa nội dung (sub-project C).
  updatedAtShopify: timestamp('updated_at_shopify'),
  // Hash địa chỉ+line hiện tại; so lần sync để bắt sửa. NULL = chưa có baseline.
  contentFingerprint: text('content_fingerprint'),
  // Lần cuối phát hiện sửa nội dung; sửa khi đã lên vận đơn → cảnh báo.
  editedAt: timestamp('edited_at'),
  editedAfterFulfilledAt: timestamp('edited_after_fulfilled_at'),
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
  // Carrier the order was shipped with, derived from the Shopify
  // `shippingLines.title` / `code` at sync time. One of:
  //   'fedex'  — FedEx shipping line detected
  //   'dhl'    — DHL shipping line detected
  //   NULL     — no shipping line on the order, or unparseable → the
  //              quote engine defaults to 'fedex' per operator spec
  // Pinned per-order so a quote always asks the right carrier's rate
  // sheet rather than picking the cheapest, which would mis-attribute
  // costs when DHL was actually used.
  shippingCarrierKey: text('shipping_carrier_key'),
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

/**
 * Master weight + variant info pulled from Shopify per store. Lets
 * SMS compute the expected shipping weight of any order/shipment by
 * summing line.qty × variant.weight_grams, and lets the per-SKU audit
 * attribute the carrier delta proportionally to each line's weight
 * contribution (instead of qty share, which over-weights small gift
 * items that share an order with heavy dresses).
 *
 * Synced periodically by `scripts/sync-shopify-variants.ts`. Refreshed
 * rows always overwrite the prior snapshot — there's no history kept,
 * because Shopify itself is the source of truth.
 */
export const shopifyVariants = pgTable('shopify_variants', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyVariantId: text('shopify_variant_id').notNull(), // gid://shopify/ProductVariant/...
  shopifyProductId: text('shopify_product_id').notNull(),
  sku: text('sku'),
  /** Variant title — e.g. "M / Cream". Null when the product has no options. */
  variantTitle: text('variant_title'),
  /** Parent product title — denormalised so audit reports don't need a second join. */
  productTitle: text('product_title').notNull(),
  /**
   * Weight in GRAMS, regardless of the unit Shopify presents to the
   * merchant — we normalise at sync time so callers can sum freely
   * without re-checking the unit. Null when the merchant left weight
   * unset on the variant (Shopify allows that).
   */
  weightGrams: numeric('weight_grams', { precision: 12, scale: 3 }),
  /**
   * Original unit Shopify reported (KILOGRAMS / GRAMS / POUNDS /
   * OUNCES). Preserved so we can surface "weight set in lb on Shopify"
   * for operators who want to audit at source.
   */
  weightUnit: text('weight_unit'),
  /** True when Shopify marked the variant as taxable; not used by
   *  the audit but cheap to carry for future analytics. */
  taxable: boolean('taxable').notNull().default(true),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('shopify_variants_unique').on(t.storeId, t.shopifyVariantId),
  index('shopify_variants_sku_idx').on(t.sku),
  index('shopify_variants_product_idx').on(t.shopifyProductId),
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

// Packaging discriminator — drives which rate-matrix the engine reads
// (BAG → Pak rate, BOX → Package rate). Excel cột AA `Select VTĐG1` parses
// to this: presence of "BAG"/"PAK" → bag, "BOX" → box, else null.
export const packagingTypeEnum = pgEnum('packaging_type', ['bag', 'box']);

export const shopifyPushStatusEnum = pgEnum('shopify_push_status', ['pending', 'pushed', 'failed']);

/**
 * One physical pack per row — what actually leaves the warehouse with
 * a label. A Shopify order can map to N shipments (multi-pack orders
 * split across labels), each with its own tracking, weight, dimensions,
 * packaging type and ship date.
 *
 * Mirrors the operator's "LOG - Export" Excel sheet where 1 row = 1 pack.
 * Populated by the Excel importer (Phase 2); the order-modal Quote and
 * dashboard estimators can also create a virtual single shipment when no
 * row exists yet so the engine still has dim/packaging input.
 */
export const shipments = pgTable('shipments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  /** Per-pack tracking number. NULL while label not yet generated. */
  trackingNumber: text('tracking_number'),
  /** Carrier the pack ships under ('fedex' | 'dhl' | …). Defaults via
   *  the order's `shippingCarrierKey` when NULL — same FedEx-default
   *  policy. Operator can override per pack when ops switches carrier. */
  carrierKey: text('carrier_key'),
  /** Physical dimensions in cm. All three required to compute dim weight. */
  dimLengthCm: numeric('dim_length_cm', { precision: 8, scale: 2 }),
  dimWidthCm: numeric('dim_width_cm', { precision: 8, scale: 2 }),
  dimHeightCm: numeric('dim_height_cm', { precision: 8, scale: 2 }),
  /** Scale weight in kg. Engine charges `max(actual, dim)`. */
  actualWeightKg: numeric('actual_weight_kg', { precision: 10, scale: 3 }),
  /** BAG → Pak rate, BOX → Package rate. NULL = unknown → engine falls
   *  back to weight-based pick (Pak under 2 kg per existing rule). */
  packagingType: packagingTypeEnum('packaging_type'),
  /** Label creation timestamp ≈ ship date. Anchor for fuel-week lookup. */
  labelCreatedAt: timestamp('label_created_at'),
  deliveryStatus: text('delivery_status'),
  deliverySource: text('delivery_source'), // 'lark' | 'fedex' | null — nguồn delivery_status
  deliveredAt: timestamp('delivered_at'),
  lastTrackedAt: timestamp('last_tracked_at'),
  trackDetail: text('track_detail'),
  /** Operator-side internal pack code (Excel col AS `Log Unique code`,
   *  e.g. PK-19379). Useful for cross-referencing the ops sheet. */
  logUniqueCode: text('log_unique_code'),
  /** Origin hub Excel col F (`SG` / `HN`). Free-text — not yet modelled
   *  in the carrier engine but useful for ops reports. */
  originHub: text('origin_hub'),
  /** Free-text note for one-off context. */
  note: text('note'),
  /** Operator who ran the secondary check-packed verification step. */
  checkPackedBy: text('check_packed_by').references(() => user.id, { onDelete: 'set null' }),
  /** Timestamp when the check-packed verification was completed. */
  checkPackedAt: timestamp('check_packed_at'),
  shopifyFulfillmentId: text('shopify_fulfillment_id'),
  shopifyPushStatus: shopifyPushStatusEnum('shopify_push_status'),
  shopifyPushError: text('shopify_push_error'),
  shopifyPushedAt: timestamp('shopify_pushed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('shipments_tracking_idx').on(t.trackingNumber),
  index('shipments_order_idx').on(t.orderId),
  index('shipments_log_unique_code_idx').on(t.logUniqueCode),
]);

/**
 * Per-shipment carrier charge — what the carrier actually billed for a
 * single pack. Imported from the operator's LOG-Export Excel (one row
 * per pack, cols AI–BV). Same column shape works for FedEx + DHL.
 *
 * Linked to `shipments` 1:1 in v1 (carrier may bill the same tracking
 * twice in rare adjustment cases — future extension). Engine's
 * `quote()` produces a parallel breakdown; reconciliation report
 * diffs the two.
 *
 * Amounts in `currency` (ops sheet is uniformly VND for Vietnam ops).
 */
export const shipmentCharges = pgTable('shipment_charges', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'cascade' }).notNull(),
  /** Which carrier rate-card account the charge belongs to.
   *  Mirrors `shipments.carrierKey` after resolution. */
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id),
  /** Tracking number from the charge — denormalised so the importer
   *  can match against shipments by tracking even when shipment_id
   *  hasn't been resolved yet (e.g. dry-run / staging). */
  trackingNumber: text('tracking_number').notNull(),
  /** Excel col AI — Total cost the carrier billed. */
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
  /** Currency of every amount on this row (VND for Vietnam ops). */
  currency: text('currency').notNull(),
  /** Excel col AJ — Published base rate before discount (FedEx) or
   *  applied base (DHL). NULL when row didn't carry the breakdown. */
  base: numeric('base', { precision: 14, scale: 2 }),
  /** Excel col AK — Fuel surcharge. */
  fuel: numeric('fuel', { precision: 14, scale: 2 }),
  /** Excel col AL — Remote-area / ODA fee. */
  remote: numeric('remote', { precision: 14, scale: 2 }),
  /** Excel col AM "EES / Theo nhu cầu" — FedEx Demand Surcharge OR the
   *  US-import handling flat fee (operator labels both under "demand"
   *  in the same column). Engine maps to `demand_per_kg` or
   *  `country_fixed`; reconciliation handles either via the engine's
   *  combined output. */
  demand: numeric('demand', { precision: 14, scale: 2 }),
  /** Excel col AN — Phí kí nhận trực tiếp (Direct Signature, flat
   *  150,000 VND for DHL). KHÔNG gộp Residential — tách riêng để đối soát rõ. */
  directSignature: numeric('direct_signature', { precision: 14, scale: 2 }),
  /** Phí giao địa chỉ nhà dân (FedEx "Residential Delivery") — dịch vụ RIÊNG
   *  với ký nhận, phẳng theo biến thể rate (80.100/84.400). Tách khỏi
   *  direct_signature để dòng đối soát không bị lẫn. Pass-through (engine
   *  không tự định giá — 2 biến thể rate cùng kỳ). */
  residential: numeric('residential', { precision: 14, scale: 2 }),
  /** Phí FedEx sửa địa chỉ sai (Address Correction) — pass-through hợp lệ khi
   *  khách nhập địa chỉ thiếu/sai (≈289.200/274.700 VND theo kỳ). Tách riêng
   *  để đối soát không coi là "thu sai"; gắn với đơn addrDeliverable=false. */
  addressCorrection: numeric('address_correction', { precision: 14, scale: 2 }),
  /** Phân loại địa chỉ người nhận theo FedEx Address Validation API
   *  (RESIDENTIAL/BUSINESS/MIXED/UNKNOWN). Dùng để xác minh phí Residential
   *  có ĐÚNG không: BUSINESS mà bị thu residential ⇒ FedEx thu sai ⇒ đòi NCC.
   *  Chỉ lưu KẾT QUẢ (không lưu địa chỉ — tránh PII). */
  residentialClass: text('residential_class'),
  residentialClassAt: timestamp('residential_class_at'),
  /** Cân TÍNH PHÍ (chargeable/billing weight) FedEx dùng cho AWB này, từ hoá
   *  đơn FBO (đã quy về KG). Dùng làm input quote chính xác nhất. */
  billingWeightKg: numeric('billing_weight_kg', { precision: 10, scale: 3 }),
  /** Excel col AO — VAT/Thuế phí khác. 8 % for Vietnam (FedEx + DHL). */
  vat: numeric('vat', { precision: 14, scale: 2 }),
  /** Excel col AP — GoGreen Plus-Basic stepped fee. */
  gogreen: numeric('gogreen', { precision: 14, scale: 2 }),
  /** DHL Non-Conveyable Piece (code YL/YO) — phụ phí kiện không qua băng chuyền.
   *  Pass-through: engine không tự định giá → đối soát kiểm theo dòng. */
  nonConveyable: numeric('non_conveyable', { precision: 14, scale: 2 }),
  /** Excel col AX — Volume contract discount. Stored as NEGATIVE VND
   *  per the invoice convention (e.g. −3,820,388). */
  discount: numeric('discount', { precision: 14, scale: 2 }),
  /** Excel col BV — Elevated Risk surcharge (DHL Middle East 918,000). */
  elevatedRisk: numeric('elevated_risk', { precision: 14, scale: 2 }),
  /** Carrier import/clearance handling fee (ops col CK "Phí xử lý hàng
   *  nhập" — FedEx US import handling 68,300đ…). Only imported when the
   *  row's billed TOTAL arithmetic includes it; reconciles (together
   *  with elevated_risk) against the engine's country_fixed line. */
  importHandling: numeric('import_handling', { precision: 14, scale: 2 }),
  /** Where the row came from — 'ops_xlsx' for current importer, future
   *  values: 'fedex_csv', 'dhl_csv', etc. */
  source: text('source').notNull(),
  /** SHA-256 of (trackingNumber + totalAmount + currency) for idempotency:
   *  re-importing the same Excel won't create duplicate rows. */
  sourceHash: text('source_hash').notNull(),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('shipment_charges_source_hash_idx').on(t.sourceHash),
  // One charge per shipment (1:1). The importer upserts on this key — a
  // re-export that corrects a row updates IN PLACE instead of inserting a
  // duplicate (which reconcile would otherwise list twice).
  uniqueIndex('shipment_charges_shipment_uniq').on(t.shipmentId),
  index('shipment_charges_tracking_idx').on(t.trackingNumber),
]);

export const reconcileStatusEnum = pgEnum('reconcile_status', ['reconciled', 'ignored', 'carrier_error', 'disputing', 'internal_error', 'credited', 'accepted']);

/** Operator-set reconciliation state for a shipment's billed-vs-engine
 *  comparison. ABSENCE of a row = "chưa đối soát" (pending). */
export const shipmentReconcileStatus = pgTable('shipment_reconcile_status', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipmentId: uuid('shipment_id')
    .references(() => shipments.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  status: reconcileStatusEnum('status').notNull(),
  note: text('note'),
  /** Snapshot of shipment_charges.total_amount when marked — lets the UI
   *  flag "billed changed since you reviewed this". */
  billedTotalAtReview: numeric('billed_total_at_review', { precision: 14, scale: 2 }),
  /** Loại lỗi carrier — chỉ set khi status='carrier_error'. */
  carrierErrorKind: text('carrier_error_kind'),
  /** Snapshot deltaVnd (billed−engine) lúc duyệt — report đúng kể cả khi bill import lại. */
  deltaVndAtReview: numeric('delta_vnd_at_review', { precision: 16, scale: 2 }),
  /** Số tiền NCC đã thu hồi (credit note) — đối chiếu với |deltaVndAtReview|. */
  recoveredVnd: numeric('recovered_vnd', { precision: 16, scale: 2 }),
  creditNoteNumber: text('credit_note_number'),
  creditNoteFileKey: text('credit_note_file_key'),
  reconciledBy: text('reconciled_by'),
  reconciledAt: timestamp('reconciled_at').defaultNow().notNull(),
});

/**
 * Reconcile issue reports — the Logistics audit trail. The reconcile page
 * groups pending mismatches into issues (sai zone, lech ER, sai can...);
 * an issue only becomes a REPORT when a Logistics staffer confirms what
 * was fixed/verified with the carrier. Reports are append-only history.
 */
export const reconcileIssueReports = pgTable('reconcile_issue_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Stable group signature, e.g. 'zone|fedex|MC|Zone E->Zone M'. */
  issueKey: text('issue_key').notNull(),
  carrierKey: text('carrier_key'),
  /** Issue description shown at confirm time (action text). */
  description: text('description').notNull(),
  /** Snapshot of the group when confirmed. */
  orderCount: integer('order_count').notNull(),
  sumDeltaVnd: numeric('sum_delta_vnd', { precision: 16, scale: 2 }),
  sampleOrders: jsonb('sample_orders'),
  /** What Logistics did / what the carrier confirmed. Required. */
  resolutionNote: text('resolution_note').notNull(),
  confirmedBy: text('confirmed_by').references(() => user.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at').defaultNow().notNull(),
}, (t) => [
  index('reconcile_issue_reports_key_idx').on(t.issueKey),
]);

/**
 * Cache báo giá FedEx Rate API per shipment — "giá đúng" (giá hợp đồng) để
 * đối soát billed(thực) vs FedEx-quote theo từng dòng. Rate API tốn phí +
 * rate-limit nên quote 1 lần/đơn rồi lưu; quote theo ĐÚNG ngày ship để ra giá
 * lịch sử. Bóc sẵn từng phụ phí (fuel/remote/demand/...) + giữ raw.
 */
export const fedexRateQuotes = pgTable('fedex_rate_quotes', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'cascade' }).notNull().unique(),
  service: text('service').notNull(),
  rateType: text('rate_type').notNull().default('ACCOUNT'),
  currency: text('currency').notNull(),
  /** Ngày ship dùng để quote (mốc giá lịch sử). */
  shipDate: timestamp('ship_date'),
  totalNetCharge: numeric('total_net_charge', { precision: 16, scale: 2 }), // gồm VAT
  baseCharge: numeric('base_charge', { precision: 16, scale: 2 }),
  fuel: numeric('fuel', { precision: 16, scale: 2 }),
  fuelPercent: numeric('fuel_percent', { precision: 8, scale: 4 }),
  residential: numeric('residential', { precision: 16, scale: 2 }),
  remote: numeric('remote', { precision: 16, scale: 2 }),
  demand: numeric('demand', { precision: 16, scale: 2 }),
  /** Ký nhận thật (SIGNATURE_OPTION). API quote thường = 0 vì là special service. */
  signature: numeric('signature', { precision: 16, scale: 2 }),
  /** Phí cố định nước (ANCILLARY_FEE = "US Inbound Processing Fee"…). */
  countryFixed: numeric('country_fixed', { precision: 16, scale: 2 }),
  vat: numeric('vat', { precision: 16, scale: 2 }),
  discount: numeric('discount', { precision: 16, scale: 2 }),
  billingWeightKg: numeric('billing_weight_kg', { precision: 10, scale: 3 }),
  rateZone: text('rate_zone'),
  raw: jsonb('raw'),
  quotedAt: timestamp('quoted_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  index('fedex_rate_quotes_shipment_idx').on(t.shipmentId),
]);

export const shopifySyncState = pgTable('shopify_sync_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull().unique(),
  backfillStatus: text('backfill_status').notNull().default('idle'),
  backfillCursor: text('backfill_cursor'),
  backfillStartedAt: timestamp('backfill_started_at'),
  backfillFinishedAt: timestamp('backfill_finished_at'),
  backfillError: text('backfill_error'),
  // --- Backfill live progress (for the sync-health UI) ---
  // Sub-phase within backfillStatus='running': 'submitting' | 'exporting' | 'ingesting'.
  backfillPhase: text('backfill_phase'),
  // Objects Shopify has exported so far (grows during the 'exporting' phase).
  backfillObjectCount: integer('backfill_object_count'),
  // Total orders to ingest (Shopify rootObjectCount, known once export completes).
  backfillTotal: integer('backfill_total'),
  // Orders upserted so far (grows during the 'ingesting' phase).
  backfillIngested: integer('backfill_ingested'),
  // Heartbeat: bumped on every progress write. The UI flags a run as stalled
  // when this stops advancing (fire-and-forget promise died / process restarted).
  backfillProgressAt: timestamp('backfill_progress_at'),
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

// ---------- Wishlist Page: catalog sản phẩm (spec 2026-07-05-wishlist-page §3) ----------
// Snapshot catalog Shopify cho recommendation engine. Sync Admin GraphQL products
// (scope read_products — cả 4 store đã có), cron daily. Upsert theo (store_id, shopify_product_id).
export const shopifyProducts = pgTable('shopify_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyProductId: text('shopify_product_id').notNull(),
  title: text('title').notNull(),
  handle: text('handle').notNull(),
  vendor: text('vendor'),
  productType: text('product_type'),
  tags: text('tags').array(),
  imageUrl: text('image_url'),
  priceMin: numeric('price_min', { precision: 14, scale: 2 }),
  currency: text('currency'),
  availableForSale: boolean('available_for_sale').notNull().default(false),
  status: text('status').notNull(),          // ACTIVE | ARCHIVED | DRAFT
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('shopify_products_store_product_idx').on(t.storeId, t.shopifyProductId),
  index('shopify_products_store_status_idx').on(t.storeId, t.status),
  index('shopify_products_store_vendor_idx').on(t.storeId, t.vendor),
]);

// Cache resolve Shopify customer GID → email (spec §4). Token extension chỉ có customerId;
// wishlist match theo email HOẶC shopifyCustomerId. TTL 7 ngày (quá hạn resolve lại qua Admin API).
export const customerIdentities = pgTable('customer_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  email: text('email'),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('customer_identities_store_customer_idx').on(t.storeId, t.shopifyCustomerId),
]);

// ─────────────────────────────────────────────────────────────────────
// Audit log for every operator action on a function. Each row records
// who changed what at which store, plus an opaque payload describing
// the change (e.g. { from: false, to: true } for a toggle, or the
// config diff for a settings update). Append-only; never delete.
// ─────────────────────────────────────────────────────────────────────
export const functionAuditLog = pgTable('function_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  functionKey: text('function_key').notNull(),
  /** Optional — some future actions (e.g. global config) won't be
   *  scoped to a single store. Toggle + per-store-config actions
   *  populate it. */
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
  /** Short verb: 'toggle' | 'config_update' | future 'delete_item' / 'cron_run' / etc.
   *  Free-text so new actions don't need a migration. */
  action: text('action').notNull(),
  /** Operator who triggered the action. Nullable so a future cron run
   *  (no session) can still log. */
  actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
  /** Shape depends on action. For toggles: { from: boolean, to: boolean }.
   *  For config updates: { before: {...}, after: {...} }. */
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('function_audit_function_idx').on(t.functionKey, t.createdAt),
  index('function_audit_store_idx').on(t.storeId, t.createdAt),
  index('function_audit_actor_idx').on(t.actorUserId, t.createdAt),
]);

// ─────────────────────────────────────────────────────────────────────
// Save-for-later — fourth function in the storefront registry. Lives
// inside the cart context: shoppers move items from the cart to a
// "saved" list (so they don't lose them) and back. Distinct from
// Wishlist because:
//   - cart-context UX (mounted on /cart, not PDP)
//   - items carry a qty (vs wishlists where qty is implicit at 1)
//   - intent is "I almost bought this" — high conversion signal
// ─────────────────────────────────────────────────────────────────────
export const saveForLaterItems = pgTable('save_for_later_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  /** Identity. Mirrors Wishlist: email when known, device id always. */
  customerEmail: text('customer_email'),
  shopifyCustomerId: text('shopify_customer_id'),
  deviceId: text('device_id').notNull(),
  shopifyProductId: text('shopify_product_id').notNull(),
  shopifyVariantId: text('shopify_variant_id'),
  productTitle: text('product_title').notNull(),
  variantTitle: text('variant_title'),
  productHandle: text('product_handle').notNull(),
  imageUrl: text('image_url'),
  priceAmount: numeric('price_amount', { precision: 14, scale: 2 }),
  priceCurrency: text('price_currency'),
  /** Quantity the shopper had in cart at the moment of saving. The
   *  "move back to cart" action restores this quantity. */
  qty: integer('qty').notNull().default(1),
  savedAt: timestamp('saved_at').defaultNow().notNull(),
}, (t) => [
  // Hot path: list a shopper's saved items.
  index('save_for_later_device_idx').on(t.storeId, t.deviceId, t.savedAt),
  index('save_for_later_email_idx').on(t.storeId, t.customerEmail, t.savedAt),
  // Dedup: same product+variant saved twice → keep the newest. The
  // storefront action upserts, so a real conflict is rare; the partial
  // unique guards against it anyway.
  uniqueIndex('save_for_later_dedup_idx')
    .on(t.storeId, t.deviceId, t.shopifyProductId, sql`COALESCE(${t.shopifyVariantId}, '')`),
]);

// ─────────────────────────────────────────────────────────────────────
// MEAN Merchant Portal (MMP) → SMS product ingestion
// ─────────────────────────────────────────────────────────────────────
// MMP pushes products from vendors/brands into SMS via signed HMAC
// webhook. SMS curates the inbound catalog and (later) syncs selected
// items to Shopify. Order-side flow: when a Shopify order can't be
// fulfilled from MEAN stock, SMS calls back to MMP so the brand can
// produce/ship.
//
// Idempotency: every product is keyed by `portal_product_id`, every
// variant by (product, sku). Re-POST upserts; no duplicates.

/** Lifecycle status sent by MMP for each product. Mirrors MMP's own
 *  state so the operator can see why a product appeared/disappeared
 *  in the inbound feed. */
export const mmpProductStatusEnum = pgEnum('mmp_product_status', [
  'live', 'draft', 'archived',
]);

/** SMS-side curation status — operator decides whether to push to
 *  Shopify after receiving from MMP. */
export const mmpCurationStatusEnum = pgEnum('mmp_curation_status', [
  // Just landed; not reviewed yet.
  'received',
  // Operator marked OK to push.
  'approved',
  // Operator rejected — won't push to Shopify.
  'rejected',
  // Sent to Shopify; mmp_products.shopify_product_id populated.
  'pushed',
  // Đã archive trên Shopify (đối soát ngược về lịch sử). Phân biệt với
  // 'approved' (đang ACTIVE/bán) — xem reconcile Denio ↔ Shopify.
  'archived',
  // Tạm dừng (brand deactive) — sp active bị đưa về draft, chờ xử lý.
  'draft',
]);

/** Brand activation state.
 *  - active:   đang hợp tác bình thường.
 *  - deactive: tạm dừng — sản phẩm đang active được đưa về draft.
 *  - archived: ngừng hợp tác hẳn — toàn bộ sản phẩm về archived. */
export const mmpBrandStatusEnum = pgEnum('mmp_brand_status', ['active', 'deactive', 'archived']);

export const mmpBrands = pgTable('mmp_brands', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Stable identifier MMP uses to namespace its products (e.g.
   *  "denio"). Also the foreign key on `mmp_products.brand_slug`. */
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** Optional notes / contact. */
  note: text('note'),
  status: mmpBrandStatusEnum('status').notNull().default('active'),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
});

export const mmpProducts = pgTable('mmp_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** MMP's stable product identifier — primary upsert key. */
  portalProductId: text('portal_product_id').notNull().unique(),
  brandSlug: text('brand_slug').references(() => mmpBrands.slug).notNull(),
  /** Master / style SKU from MMP. */
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  globalName: text('global_name'),
  shortSummary: text('short_summary'),
  description: text('description'),
  collection: text('collection'),
  productType: text('product_type'),
  status: mmpProductStatusEnum('status').notNull(),
  /** Origin of the row: 'mmp' (pushed from Mean Merchant Portal) or 'shopify'
   *  (backfilled history from an existing Shopify catalog). */
  source: text('source').notNull().default('mmp'),
  /** Cost price (giá vốn) — supplied by MMP later for brand reconciliation.
   *  NULL until provided. Currency follows `currency`. */
  costPrice: numeric('cost_price', { precision: 14, scale: 2 }),
  /** VND integer per MMP contract — stored as numeric to avoid
   *  precision loss on big amounts. */
  basePrice: numeric('base_price', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('VND'),
  priceUsd: numeric('price_usd', { precision: 10, scale: 2 }),
  /** Loose-typed metadata from MMP — fabric, silhouette, neckline,
   *  etc. Stored as jsonb so schema doesn't lock the operator to a
   *  fixed set of attributes. */
  attributes: jsonb('attributes'),
  /** Production / sample / styling metadata — also jsonb-free-form. */
  details: jsonb('details'),
  /** Operator curation. */
  curationStatus: mmpCurationStatusEnum('curation_status').notNull().default('received'),
  curationNote: text('curation_note'),
  /** Set when SMS pushes to Shopify; mirrors the GraphQL Product gid. */
  shopifyProductId: text('shopify_product_id'),
  pushedToShopifyAt: timestamp('pushed_to_shopify_at'),
  /** Bookkeeping for incremental sync. */
  lastReceivedAt: timestamp('last_received_at').defaultNow().notNull(),
  /** SHA-256 of the canonical product payload — lets the importer skip
   *  re-processing identical payloads on retries. */
  sourceHash: text('source_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('mmp_products_brand_idx').on(t.brandSlug),
  index('mmp_products_status_idx').on(t.curationStatus),
  index('mmp_products_sku_idx').on(t.sku),
]);

export const mmpProductVariants = pgTable('mmp_product_variants', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => mmpProducts.id, { onDelete: 'cascade' }).notNull(),
  /** Variant SKU — unique within the product. */
  sku: text('sku').notNull(),
  /** Free-text option values per MMP contract. */
  color: text('color'),
  size: text('size'),
  inventory: integer('inventory').notNull().default(0),
  price: numeric('price', { precision: 14, scale: 2 }).notNull(),
  /** Garment length in cm — min / max for ranges. Optional. */
  lengthCm: numeric('length_cm', { precision: 8, scale: 2 }),
  lengthCmMax: numeric('length_cm_max', { precision: 8, scale: 2 }),
  /** Position MMP wants this variant displayed at. */
  position: integer('position').notNull().default(0),
  /** Shopify linkage — populated after the SMS → Shopify push. */
  shopifyVariantId: text('shopify_variant_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('mmp_product_variants_product_sku_idx').on(t.productId, t.sku),
]);

export const mmpProductImages = pgTable('mmp_product_images', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => mmpProducts.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  position: integer('position').notNull().default(0),
  /** MMP-defined role: full_body | back | front_close | detail | fabric
   *  | unassigned. Stored free-text so MMP can extend without a
   *  migration. */
  role: text('role'),
  isThumbnail: boolean('is_thumbnail').notNull().default(false),
  altText: text('alt_text'),
}, (t) => [
  uniqueIndex('mmp_product_images_product_url_idx').on(t.productId, t.url),
  index('mmp_product_images_product_position_idx').on(t.productId, t.position),
]);

/** One row per inbound HMAC webhook call — audit / debugging aid. The
 *  endpoint writes a row even when the payload is rejected so the
 *  operator can investigate signature failures, replay-window misses,
 *  schema validation breaks. */
export const mmpIngestionRuns = pgTable('mmp_ingestion_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** SHA-256 of the raw request body — idempotency / dedup. */
  payloadHash: text('payload_hash').notNull(),
  /** 'accepted' / 'signature_failed' / 'timestamp_skew' / 'schema_error'
   *  / 'internal_error'. */
  result: text('result').notNull(),
  /** Count of products in this batch. */
  productCount: integer('product_count').notNull().default(0),
  acceptedCount: integer('accepted_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  /** First detail line — full errors live in `errors` jsonb. */
  errorSummary: text('error_summary'),
  errors: jsonb('errors'),
  /** Source IP for forensic trail; not used for auth. */
  sourceIp: text('source_ip'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  processingMs: integer('processing_ms'),
}, (t) => [
  index('mmp_ingestion_runs_received_idx').on(t.receivedAt),
  index('mmp_ingestion_runs_hash_idx').on(t.payloadHash),
]);

// ─────────────────────────────────────────────────────────────────────
// Order Operations / Fulfillment Phase 1
// ─────────────────────────────────────────────────────────────────────

export const fulfillmentLineStatusEnum = pgEnum('fulfillment_line_status', [
  'pending_check', 'in_stock', 'out_of_stock', 'picked', 'packed', 'shipped',
  'brand_requested', 'brand_confirmed', 'brand_rejected',
]);
export const fulfillmentOrderStatusEnum = pgEnum('fulfillment_order_status', [
  'received', 'checking', 'awaiting_brand', 'ready_to_pick', 'picking', 'packed', 'shipped',
]);

export const receiptSourceTypeEnum = pgEnum('receipt_source_type', ['retail_for_order', 'consignment', 'po']);
export const qcResultEnum = pgEnum('qc_result', ['pending', 'pass', 'fail']);
export const receiptItemDispositionEnum = pgEnum('receipt_item_disposition', ['pending', 'allocate_to_order', 'store', 'return_to_brand']);
export const warehouseItemStatusEnum = pgEnum('warehouse_item_status', [
  'pending', 'in_stock', 'staging', 'allocated', 'picked', 'shipped',
  'qc_failed', 'returned_to_vendor',
]);

/** MEAN warehouse stock, keyed by (sku, warehouse_code). Operator-managed (manual entry). */
export const warehouseInventory = pgTable('warehouse_inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: text('sku').notNull(),
  /** Kho vật lý chứa hàng: 'GVM' | 'AP' | 'DM'. Tồn tách theo (sku, kho). */
  warehouseCode: text('warehouse_code').notNull().default('GVM'),
  productTitle: text('product_title'),
  variantTitle: text('variant_title'),
  qtyOnHand: integer('qty_on_hand').notNull().default(0),
  qtyReserved: integer('qty_reserved').notNull().default(0),
  shelf: text('shelf'),
  floor: text('floor'),
  bin: text('bin'),
  note: text('note'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('warehouse_inventory_sku_warehouse_idx').on(t.sku, t.warehouseCode),
  check('warehouse_qty_on_hand_nonneg', sql`${t.qtyOnHand} >= 0`),
  check('warehouse_qty_reserved_nonneg', sql`${t.qtyReserved} >= 0`),
  check('warehouse_reserved_lte_on_hand', sql`${t.qtyReserved} <= ${t.qtyOnHand}`),
]);

export const inventoryMovementReasonEnum = pgEnum('inventory_movement_reason', [
  'receipt_po', 'receipt_consignment', 'receipt_return',
  'auto_allocate', 'release_allocation', 'pick',
  'manual_adjust', 'transfer_in', 'transfer_out', 'migration',
]);

/** Ledger append-only: MỌI biến động tồn đi qua applyMovement (ledger.ts — Task 3+),
 *  không UPDATE qty trực tiếp ở bất kỳ đâu khác. */
export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  warehouseInventoryId: uuid('warehouse_inventory_id')
    .references(() => warehouseInventory.id, { onDelete: 'restrict' }).notNull(),
  deltaOnHand: integer('delta_on_hand').notNull().default(0),
  deltaReserved: integer('delta_reserved').notNull().default(0),
  reason: inventoryMovementReasonEnum('reason').notNull(),
  /** 'receipt_item' | 'fulfillment_line' | 'order' | 'transfer' */
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  note: text('note'),
  /** user id hoặc 'system:allocator' */
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('inventory_movements_inv_idx').on(t.warehouseInventoryId, t.createdAt),
  index('inventory_movements_reason_idx').on(t.reason),
]);

/** One ops record per Shopify order. status = rollup derived from lines. */
export const orderFulfillment = pgTable('order_fulfillment', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull().unique(),
  status: fulfillmentOrderStatusEnum('status').notNull().default('received'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('order_fulfillment_status_idx').on(t.status)]);

/** Per order-line fulfillment state. */
export const orderFulfillmentLines = pgTable('order_fulfillment_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  fulfillmentId: uuid('fulfillment_id').references(() => orderFulfillment.id, { onDelete: 'cascade' }).notNull(),
  shopifyLineId: text('shopify_line_id').notNull(),
  sku: text('sku'),
  qty: integer('qty').notNull(),
  status: fulfillmentLineStatusEnum('status').notNull().default('pending_check'),
  warehouseInventoryId: uuid('warehouse_inventory_id').references(() => warehouseInventory.id),
  allocatedQty: integer('allocated_qty').notNull().default(0),
  shipmentId: uuid('shipment_id').references(() => shipments.id),
  pickedAt: timestamp('picked_at'),
  packedAt: timestamp('packed_at'),
  shippedAt: timestamp('shipped_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('order_fulfillment_lines_ful_idx').on(t.fulfillmentId),
  uniqueIndex('order_fulfillment_lines_ful_line_idx').on(t.fulfillmentId, t.shopifyLineId),
  // reallocateSku quét (sku, status='out_of_stock') trên mỗi lần nhập kho.
  index('order_fulfillment_lines_sku_status_idx').on(t.sku, t.status),
]);

export const mmpPushStatusEnum = pgEnum('mmp_push_status', ['pending', 'sent', 'failed']);

export const brandRequestSendStatusEnum = pgEnum('brand_request_send_status', ['pending', 'sent', 'failed']);
export const brandRequestConfirmStatusEnum = pgEnum('brand_request_confirm_status', ['awaiting', 'confirmed', 'rejected']);

/** One production request to a brand (via MMP) per out-of-stock line. */
export const brandOrderRequests = pgTable('brand_order_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  fulfillmentLineId: uuid('fulfillment_line_id')
    .references(() => orderFulfillmentLines.id, { onDelete: 'cascade' })
    .notNull().unique(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  brandSlug: text('brand_slug'),
  sku: text('sku'),
  qty: integer('qty').notNull(),
  sendStatus: brandRequestSendStatusEnum('send_status').notNull().default('pending'),
  sendAttempts: integer('send_attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at'),
  externalRef: text('external_ref'),
  confirmStatus: brandRequestConfirmStatusEnum('confirm_status').notNull().default('awaiting'),
  expectedDeliveryDate: date('expected_delivery_date'),
  note: text('note'),
  confirmedAt: timestamp('confirmed_at'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('brand_order_requests_confirm_idx').on(t.confirmStatus),
  index('brand_order_requests_order_idx').on(t.orderId),
]);

/** Trạng thái đẩy MỖI đơn sang MMP (kênh orders) — cờ đã-đẩy + retry. 1 dòng/đơn. */
export const mmpOrderPushes = pgTable('mmp_order_pushes', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull().unique(),
  status: mmpPushStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at'),
  externalRef: text('external_ref'),
  payloadHash: text('payload_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('mmp_order_pushes_status_idx').on(t.status),
]);

// Ngày MEAN nhận hàng từ brand, theo (đơn, SKU) — sync từ bảng Lark riêng
// (base HxfAw0iRViHiNgkSlbBltpVkg3f / table tblFtdIn8H7ftfBL, cột
// "Visible - WH-Ngày MEAN nhận hàng gần nhất"). Nguồn receivedAt đẩy MMP.
// order_number lưu dạng bare (bỏ '#').
export const mmpLineReceived = pgTable('mmp_line_received', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNumber: text('order_number').notNull(),
  sku: text('sku').notNull(),
  receivedAt: timestamp('received_at').notNull(),
  vendor: text('vendor'),
  // 'lark' = ops ghi thật (bảng Lark WH) · 'estimate_fulfill' = ước từ mốc
  // fulfill Shopify (backfill đơn TA cũ 2024-2025 trước khi có bảng Lark).
  source: text('source').notNull().default('lark'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('mmp_line_received_order_sku_idx').on(t.orderNumber, t.sku),
  index('mmp_line_received_order_idx').on(t.orderNumber),
]);

/** Audit log of status transitions. */
export const orderFulfillmentEvents = pgTable('order_fulfillment_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  fulfillmentId: uuid('fulfillment_id').references(() => orderFulfillment.id, { onDelete: 'cascade' }).notNull(),
  lineId: uuid('line_id'),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actor: text('actor'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// Goods Receiving & QC (sub-project A)
// ─────────────────────────────────────────────────────────────────────

/** A receiving session/document: one delivery of one source type from a vendor. */
export const goodsReceipts = pgTable('goods_receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  warehouseCode: text('warehouse_code').notNull().default('GVM'),
  sourceType: receiptSourceTypeEnum('source_type').notNull(),
  vendor: text('vendor'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  receivedBy: text('received_by').references(() => user.id, { onDelete: 'set null' }),
  handoverDocKey: text('handover_doc_key'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('goods_receipts_source_idx').on(t.sourceType)]);

/** One physical unit received. QC + disposition are per-unit. */
export const goodsReceiptItems = pgTable('goods_receipt_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  receiptId: uuid('receipt_id').references(() => goodsReceipts.id, { onDelete: 'cascade' }).notNull(),
  unitCode: text('unit_code').notNull().unique(),
  sku: text('sku'),
  productTitle: text('product_title'),
  variantTitle: text('variant_title'),
  photoKey: text('photo_key'),
  qcResult: qcResultEnum('qc_result').notNull().default('pending'),
  qcFailReason: text('qc_fail_reason'),
  qcFailPhotoKey: text('qc_fail_photo_key'),
  qcCheckedBy: text('qc_checked_by').references(() => user.id, { onDelete: 'set null' }),
  qcCheckedAt: timestamp('qc_checked_at'),
  disposition: receiptItemDispositionEnum('disposition').notNull().default('pending'),
  vendorReturnDocKey: text('vendor_return_doc_key'),
  brandRequestId: uuid('brand_request_id').references(() => brandOrderRequests.id, { onDelete: 'set null' }),
  fulfillmentLineId: uuid('fulfillment_line_id').references(() => orderFulfillmentLines.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'set null' }),
  domPrice: numeric('dom_price', { precision: 14, scale: 2 }),
  domPriceCurrency: text('dom_price_currency'),
  globalPrice: numeric('global_price', { precision: 14, scale: 2 }),
  globalPriceCurrency: text('global_price_currency'),
  weightKg: numeric('weight_kg', { precision: 10, scale: 3 }),
  /** Kho hiện tại của món (GVM/AP/DM) — đổi khi chuyển kho. NULL tới khi lưu kho. */
  currentWarehouseCode: text('current_warehouse_code'),
  /** Vị trí trong kho ("Kệ 6-F"). */
  location: text('location'),
  /** Vòng đời món trong kho. Default pending tới khi QC + lưu kho. */
  stockStatus: warehouseItemStatusEnum('stock_status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('goods_receipt_items_receipt_idx').on(t.receiptId),
  index('goods_receipt_items_qc_idx').on(t.qcResult),
  index('goods_receipt_items_line_idx').on(t.fulfillmentLineId),
  index('goods_receipt_items_disposition_idx').on(t.disposition),
  index('gri_stock_pick_idx').on(t.sku, t.stockStatus, t.currentWarehouseCode),
]);

/** Nhật ký mỗi lần sync Lark → shipments. Bản ghi mới nhất cấp dữ liệu cho
 *  banner cảnh báo "đơn Lark không khớp order". */
export const larkSyncRuns = pgTable('lark_sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ranAt: timestamp('ran_at').notNull().defaultNow(),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  unmatchedCount: integer('unmatched_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  /** [{ orderNumber, reason }] — đơn Lark không tạo được shipment. */
  unmatched: jsonb('unmatched').notNull().default(sql`'[]'::jsonb`),
  error: text('error'),
});

/** Snapshot status Lark/đơn (Phần B). Cron sync upsert; worklist LEFT JOIN để
 *  hiện cột "Lark (vận hành)". 1 dòng / đơn. */
export const larkOrderStatus = pgTable('lark_order_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().unique()
    .references(() => shopifyOrders.id, { onDelete: 'cascade' }),
  dispatchStatus: text('dispatch_status'),
  cxFfStatus: text('cx_ff_status'),
  deliveryStatus: text('delivery_status'),
  expectedDeliveryDate: date('expected_delivery_date'),
  qcStatus: text('qc_status'), // fail|pending|pass|extra (gom từ Lark QC Check)
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

// ---- Ship Hộ (partner proxy shipping) -------------------------------------
export const shipHoBillingCycleEnum = pgEnum('ship_ho_billing_cycle', ['weekly', 'monthly']);
export const shipHoPartnerStatusEnum = pgEnum('ship_ho_partner_status', ['active', 'inactive']);
export const shipHoOrderStatusEnum = pgEnum('ship_ho_order_status', [
  'draft', 'quoted', 'shipped', 'delivered', 'billed', 'settled',
]);
export const shipHoStatementStatusEnum = pgEnum('ship_ho_statement_status', ['draft', 'issued', 'paid']);

/** Bật dịch vụ ship hộ cho 1 brand (mmp_brands). 1 config / brand. */
export const shipHoPartners = pgTable('ship_ho_partners', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandSlug: text('brand_slug').references(() => mmpBrands.slug).notNull().unique(),
  /** LEGACY — pricing đã chuyển sang tier (spec 09/07/2026); giữ đọc tham khảo. */
  markupPercent: numeric('markup_percent', { precision: 8, scale: 4 }).notNull().default('0'),
  billingCycle: shipHoBillingCycleEnum('billing_cycle').notNull().default('monthly'),
  billingCurrency: text('billing_currency').notNull().default('VND'),
  status: shipHoPartnerStatusEnum('status').notNull().default('active'),
  selfServiceEnabled: boolean('self_service_enabled').notNull().default(false),
  // Tier chiết khấu (tier-pricing.ts): strategic luôn Platinum; override admin ép;
  // tier_code = auto theo volume tháng trước (cron ghi đầu tháng).
  strategic: boolean('strategic').notNull().default(false),
  tierCode: text('tier_code').notNull().default('standard'),
  tierOverrideCode: text('tier_override_code'),
  tierUpdatedAt: timestamp('tier_updated_at'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Bảng kê kỳ (P3 dùng; tạo sẵn để ship_ho_orders.statement_id FK được). */
export const shipHoStatements = pgTable('ship_ho_statements', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerBrandSlug: text('partner_brand_slug').references(() => mmpBrands.slug).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  orderCount: integer('order_count').notNull().default(0),
  totalChargedVnd: numeric('total_charged_vnd', { precision: 16, scale: 2 }).notNull().default('0'),
  status: shipHoStatementStatusEnum('status').notNull().default('draft'),
  issuedAt: timestamp('issued_at'),
  paidAt: timestamp('paid_at'),
  fileKey: text('file_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Đơn ship hộ (nhập tay P1; import lô P2). */
export const shipHoOrders = pgTable('ship_ho_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  partnerBrandSlug: text('partner_brand_slug').references(() => mmpBrands.slug).notNull(),
  // Người nhận
  recipientName: text('recipient_name'),
  recipientCompany: text('recipient_company'),
  recipientPhone: text('recipient_phone'),
  recipientEmail: text('recipient_email'),
  country: text('country').notNull(),
  city: text('city'),
  province: text('province'),
  postcode: text('postcode'),
  address1: text('address1'),
  address2: text('address2'),
  // Trường địa chỉ custom theo quốc gia (Trung Đông)
  houseNumber: text('house_number'),
  shortAddress: text('short_address'),
  mapsUrl: text('maps_url'),
  // Kiện
  weightKg: numeric('weight_kg', { precision: 10, scale: 3 }).notNull(),
  dimLengthCm: numeric('dim_length_cm', { precision: 10, scale: 2 }),
  dimWidthCm: numeric('dim_width_cm', { precision: 10, scale: 2 }),
  dimHeightCm: numeric('dim_height_cm', { precision: 10, scale: 2 }),
  packagingType: text('packaging_type'), // 'bag' | 'box' | null
  // Brand self-service (MMP)
  source: text('source').notNull().default('internal'), // 'internal' | 'mmp'
  mmpRef: text('mmp_ref'),
  customerRef: text('customer_ref'),
  service: text('service'), // 'express' | 'standard'
  mmpOrderSeq: bigint('mmp_order_seq', { mode: 'number' }),
  // Carrier
  carrierKey: text('carrier_key'),
  carrierAccountId: uuid('carrier_account_id').references(() => carrierAccounts.id),
  // Giá (snapshot bất biến)
  carrierCostVnd: numeric('carrier_cost_vnd', { precision: 16, scale: 2 }),
  markupPercent: numeric('markup_percent', { precision: 8, scale: 4 }),
  chargedVnd: numeric('charged_vnd', { precision: 16, scale: 2 }),
  quoteBreakdown: jsonb('quote_breakdown'),
  quotedAt: timestamp('quoted_at'),
  // Tracking (P2)
  trackingNumber: text('tracking_number'),
  // Ngày đi hàng (Logistic staff): mặc định = ngày nhập tracking, sửa được vì có
  // thể tạo tracking trước rồi đi hàng chậm 1-2 ngày. Dùng làm ngày hiệu lực fuel
  // khi bill chưa về / dòng bill thiếu ship_date (bill vẫn thắng khi có).
  shippedAt: date('shipped_at'),
  deliveryStatus: text('delivery_status'),
  deliveredAt: timestamp('delivered_at'),
  lastTrackedAt: timestamp('last_tracked_at'),
  // Đối soát (P3)
  actualCarrierCostVnd: numeric('actual_carrier_cost_vnd', { precision: 16, scale: 2 }),
  reconcileStatus: text('reconcile_status'),
  deltaVnd: numeric('delta_vnd', { precision: 16, scale: 2 }),
  marginVnd: numeric('margin_vnd', { precision: 16, scale: 2 }),
  // Re-bill theo cân thực: kéo từ hoá đơn carrier (carrier_bill_lines) theo tracking.
  //   actualWeightKg     = cân thực carrier bill.
  //   actualChargedVnd   = giá thu brand tính LẠI trên cân thực (re-quote, fuel tuần giao).
  //   actualBillBreakdown= phụ phí thực + billNumber (jsonb, minh bạch).
  actualWeightKg: numeric('actual_weight_kg', { precision: 10, scale: 3 }),
  actualChargedVnd: numeric('actual_charged_vnd', { precision: 16, scale: 2 }),
  actualBillBreakdown: jsonb('actual_bill_breakdown'),
  // Quyết định đối soát khi bill về CÓ sai lệch (deltaVnd≠0): operator xử lý tay.
  //   pending_review = chờ xử lý (chưa đẩy giá) · accepted = chấp nhận lỗi nội bộ
  //   (đã đẩy giá chính thức) · claiming = đòi carrier (đợi claim, giá giữ quote).
  //   null = không cần duyệt (khớp / chưa có bill) — vẫn tự đẩy giá như cũ.
  reconcileDecision: text('reconcile_decision'),
  reconcileDecisionAt: timestamp('reconcile_decision_at'),
  reconcileDecisionBy: text('reconcile_decision_by'),
  /** Lý do claim (tuỳ chọn) — gửi kèm MMP + lưu vết. */
  claimReason: text('claim_reason'),
  // Cân & đo LẠI tại kho SMS khi hàng về (đối chiếu với số brand khai bên MMP).
  smsWeightKg: numeric('sms_weight_kg', { precision: 10, scale: 3 }),
  smsDimLengthCm: numeric('sms_dim_length_cm', { precision: 10, scale: 2 }),
  smsDimWidthCm: numeric('sms_dim_width_cm', { precision: 10, scale: 2 }),
  smsDimHeightCm: numeric('sms_dim_height_cm', { precision: 10, scale: 2 }),
  smsMeasuredAt: timestamp('sms_measured_at'),
  smsMeasuredBy: text('sms_measured_by'),
  // Bill (P3)
  statementId: uuid('statement_id').references(() => shipHoStatements.id),
  status: shipHoOrderStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
});

export const shipHoEventStatusEnum = pgEnum('ship_ho_event_status', ['pending', 'delivered', 'failed']);

export const shipHoOrderEvents = pgTable('ship_ho_order_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shipHoOrders.id).notNull(),
  mmpRef: text('mmp_ref').notNull(),
  code: text('code').notNull(),
  event: text('event').notNull(),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  payload: jsonb('payload').notNull(),
  deliveryStatus: shipHoEventStatusEnum('delivery_status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const shipHoPartnerRequestStatusEnum = pgEnum('ship_ho_partner_request_status', ['pending', 'approved', 'rejected']);

export const shipHoPartnerRequests = pgTable('ship_ho_partner_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandSlug: text('brand_slug').notNull(),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  status: shipHoPartnerRequestStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').notNull(),
  reviewNote: text('review_note'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  callbackSentAt: timestamp('callback_sent_at'),
  callbackError: text('callback_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- Order Lifecycle (vòng đời đơn + SLA) ----------------------------------
/** SLA mặc định toàn hệ thống cho từng đoạn vòng đời (admin sửa trong UI P2).
 *  key: placed_to_production | production | qc | pack | ship | deliver. */
export const lifecycleSla = pgTable('lifecycle_sla', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  targetHours: integer('target_hours').notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Snapshot vòng đời 1 dòng/đơn — cron sync-lifecycle đối chiếu tín hiệu nguồn
 *  và upsert. Các mốc first-seen (qc_pass/in_transit/out_for_delivery/
 *  return_processing) chỉ set khi đang null. */
export const orderLifecycle = pgTable('order_lifecycle', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull().unique(),
  storeId: uuid('store_id').references(() => stores.id).notNull(),
  currentStage: text('current_stage').notNull().default('placed'),
  exception: boolean('exception').notNull().default(false),
  exceptionNote: text('exception_note'),
  // Mốc vòng đời (spec §3)
  placedAt: timestamp('placed_at'),
  productionStartAt: timestamp('production_start_at'),
  productionConfirmedAt: timestamp('production_confirmed_at'),
  productionEta: date('production_eta'),
  goodsReceivedAt: timestamp('goods_received_at'),
  qcPassAt: timestamp('qc_pass_at'),
  packedAt: timestamp('packed_at'),
  shippedAt: timestamp('shipped_at'),
  inTransitAt: timestamp('in_transit_at'),
  outForDeliveryAt: timestamp('out_for_delivery_at'),
  deliveredAt: timestamp('delivered_at'),
  returnProcessingAt: timestamp('return_processing_at'),
  refundedAt: timestamp('refunded_at'),
  completedAt: timestamp('completed_at'),
  cancelledAt: timestamp('cancelled_at'),
  // Delay (spec §4)
  deadline: timestamp('deadline'),
  delayStatus: text('delay_status').notNull().default('on_track'), // on_track|due_soon|overdue
  delayHours: integer('delay_hours').notNull().default(0),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
}, (t) => [
  index('order_lifecycle_stage_idx').on(t.currentStage),
  index('order_lifecycle_delay_idx').on(t.delayStatus),
  index('order_lifecycle_store_idx').on(t.storeId),
]);

// ---------- Geo master (spec 2026-07-04-geo-master-design.md §3) ----------
// Nguồn GeoNames per-country; nước chưa nạp → app fallback static lib/geo.

export const geoStates = pgTable('geo_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(), // ISO-3166-1 alpha-2
  code: text('code').notNull(),                // admin1 code (vd 'CA')
  name: text('name').notNull(),
}, (t) => [
  uniqueIndex('geo_states_country_code_uq').on(t.countryCode, t.code),
]);

export const geoCities = pgTable('geo_cities', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(),
  stateCode: text('state_code'),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull(), // UPPERCASE alnum — khớp quote engine
}, (t) => [
  uniqueIndex('geo_cities_uq').on(t.countryCode, t.stateCode, t.nameNorm),
  index('geo_cities_country_idx').on(t.countryCode),
]);

export const geoPostcodes = pgTable('geo_postcodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull(),
  postcode: text('postcode').notNull(),       // raw như GeoNames
  postcodeNorm: text('postcode_norm').notNull(),
  city: text('city').notNull(),
  stateCode: text('state_code'),
  lat: numeric('lat', { precision: 9, scale: 5 }),
  lng: numeric('lng', { precision: 9, scale: 5 }),
}, (t) => [
  uniqueIndex('geo_postcodes_uq').on(t.countryCode, t.postcodeNorm, t.city),
  index('geo_postcodes_lookup_idx').on(t.countryCode, t.postcodeNorm),
]);

export const geoImports = pgTable('geo_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  countryCode: text('country_code').notNull().unique(),
  source: text('source').notNull().default('geonames'),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
  rows: integer('rows').notNull().default(0),
});

// ---------- Customer Account Builder (spec 2026-07-05-customer-account-builder-design.md §4) ----------

export const customerAccountConfigs = pgTable('customer_account_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  /** Shape TS: features/customer-account/config-schema.ts (branding + modules[]) */
  config: jsonb('config').notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Kết quả Style Quiz mỗi khách/session. answers + profile (3 trục) là jsonb;
 *  câu hỏi giữ trong code (features/customer-account/style-quiz). */
export const styleQuizResults = pgTable('style_quiz_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id),
  customerId: text('customer_id'),
  sessionKey: text('session_key').notNull(),
  answers: jsonb('answers').notNull().default({}),
  /** Shape TS: StyleProfile (features/customer-account/style-quiz/profile.ts) */
  profile: jsonb('profile'),
  levelReached: integer('level_reached').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  storeCustomerIdx: index('style_quiz_results_store_customer_idx').on(t.storeId, t.customerId),
  sessionIdx: index('style_quiz_results_session_idx').on(t.sessionKey),
}));

export const customerAccountAssets = pgTable('customer_account_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  kind: text('kind').notNull(), // 'logo' | 'hero' | 'icon'
  filename: text('filename').notNull(),
  fileKey: text('file_key').notNull(),
  contentType: text('content_type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('customer_account_assets_store_idx').on(t.storeId)]);

export const customerLoyalty = pgTable('customer_loyalty', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  tier: text('tier').notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('customer_loyalty_uq').on(t.storeId, t.shopifyCustomerId)]);

// ---------- Order Journey (spec 2026-07-05-order-journey-design.md §5) ----------
// Danh mục hub nhận hàng return (US / Middle East / VN…). Operation chọn hub khi duyệt claim.
export const returnHubs = pgTable('return_hubs', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(),                  // "US Hub"
  recipientName: text('recipient_name').notNull(),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text('city').notNull(),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country').notNull(),              // ISO alpha-2, vd "US"
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Bảng HỢP NHẤT yêu cầu của khách trên một đơn: cancel | claim. Một state machine.
// Tiền snapshot lúc tạo (bất biến) — admin refund đúng một con số.
export const customerOrderRequests = pgTable('customer_order_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  orderId: uuid('order_id').references(() => shopifyOrders.id, { onDelete: 'cascade' }).notNull(),
  shopifyCustomerId: text('shopify_customer_id').notNull(),
  orderNumber: text('order_number'),
  kind: text('kind').notNull(),                    // cancel | claim
  status: text('status').notNull(),                // xem features/customer-account/request-status.ts
  reasonCodes: text('reason_codes').array(),       // claim
  description: text('description'),
  photoKeys: text('photo_keys').array(),           // S3 keys, claim
  fault: text('fault'),                            // customer | mean — admin điền khi duyệt
  returnHubId: uuid('return_hub_id').references(() => returnHubs.id),
  returnShippingPayer: text('return_shipping_payer'), // customer | mean
  returnTrackingNumber: text('return_tracking_number'),
  returnCarrier: text('return_carrier'),
  orderTotal: numeric('order_total', { precision: 14, scale: 2 }).notNull(),
  refundPercent: integer('refund_percent').notNull(), // 100 | 60
  refundAmount: numeric('refund_amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull(),
  adminNote: text('admin_note'),
  rejectedReason: text('rejected_reason'),
  reviewedAt: timestamp('reviewed_at'),
  approvedAt: timestamp('approved_at'),
  trackingAddedAt: timestamp('tracking_added_at'),
  receivedAt: timestamp('received_at'),
  qcAt: timestamp('qc_at'),
  refundedAt: timestamp('refunded_at'),
  refundedMarkedBy: text('refunded_marked_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('customer_order_requests_store_status_idx').on(t.storeId, t.status),
  index('customer_order_requests_order_idx').on(t.orderId),
  index('customer_order_requests_customer_idx').on(t.storeId, t.shopifyCustomerId),
]);
