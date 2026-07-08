ALTER TABLE "ship_ho_orders" ADD COLUMN "sms_weight_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "sms_dim_length_cm" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "sms_dim_width_cm" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "sms_dim_height_cm" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "sms_measured_at" timestamp;--> statement-breakpoint
ALTER TABLE "ship_ho_orders" ADD COLUMN "sms_measured_by" text;
