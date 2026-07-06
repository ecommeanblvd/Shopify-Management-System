INSERT INTO "carriers" ("key", "name")
VALUES ('ups', 'UPS')
ON CONFLICT ("key") DO NOTHING;
