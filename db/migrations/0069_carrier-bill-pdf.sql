ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_file_key" text;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_filename" text;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_content_type" text;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_byte_size" integer;
