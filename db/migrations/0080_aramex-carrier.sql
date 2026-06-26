ALTER TABLE "carrier_accounts" ALTER COLUMN "fx_cost_per_display" TYPE numeric(20, 10);

INSERT INTO "carriers" ("key", "name")
VALUES ('aramex', 'Aramex (Hợp Nhất)')
ON CONFLICT ("key") DO NOTHING;
