INSERT INTO "carriers" ("key", "name")
VALUES ('sf-express', 'SF Express (ShunFeng)')
ON CONFLICT ("key") DO NOTHING;
