ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_amount" numeric(14, 2);
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_issue_date" date;
ALTER TABLE "carrier_bills" ADD COLUMN IF NOT EXISTS "pdf_due_date" date;
