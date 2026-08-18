-- Từ điển geo (geo_cities 52MB, geo_postcodes 173MB) đã chuyển sang Supabase Storage
-- (geo-dict/{CC}.json.gz, features/geo/geo-store.ts — Task 1-4). Parity check
-- (scripts/verify-geo-parity.ts) PASS sạch cả 16 nước trước khi drop. Backup CSV 2 bảng
-- về /Users/macos/Documents/sms-prod-backups/geo-YYYYMMDD/ TRƯỚC khi apply migration này
-- lên prod (xem docs/superpowers/plans/2026-08-18-geo-dict-to-storage.md §Task 5).
-- carrier_remote_postcodes_lookup_idx: index thừa, đã là prefix của unique idx
-- carrier_remote_postcodes_account_country_pattern_from_idx — không đụng data/engine
-- carrier_remote_postcodes.
drop index if exists carrier_remote_postcodes_lookup_idx;
drop table if exists geo_postcodes;
drop table if exists geo_cities;
