import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index, integer } from 'drizzle-orm/pg-core';
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
  marketHandle: text('market_handle').references(() => marketTemplates.handle).notNull(),
  priceAdjustment: jsonb('price_adjustment'),
  shipping: jsonb('shipping'),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('market_store_overrides_store_handle_idx').on(table.storeId, table.marketHandle),
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

export * from './auth-schema';
