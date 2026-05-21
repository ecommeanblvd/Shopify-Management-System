ALTER TABLE "market_store_overrides" DROP CONSTRAINT "market_store_overrides_market_handle_market_templates_handle_fk";
--> statement-breakpoint
DROP INDEX "market_store_overrides_store_handle_idx";--> statement-breakpoint
ALTER TABLE "market_store_overrides" ADD CONSTRAINT "market_store_overrides_store_id_market_handle_pk" PRIMARY KEY("store_id","market_handle");--> statement-breakpoint
ALTER TABLE "market_store_overrides" ADD CONSTRAINT "market_store_overrides_market_handle_market_templates_handle_fk" FOREIGN KEY ("market_handle") REFERENCES "public"."market_templates"("handle") ON DELETE no action ON UPDATE cascade;