ALTER TABLE "carrier_rate_cards" ADD COLUMN "source_pdf_key" text;--> statement-breakpoint
ALTER TABLE "carrier_rate_cards" ADD COLUMN "source_pdf_filename" text;--> statement-breakpoint
ALTER TABLE "carrier_rate_cards" ADD COLUMN "source_pdf_uploaded_at" timestamp;