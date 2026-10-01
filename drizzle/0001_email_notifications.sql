ALTER TABLE "candidates" ADD COLUMN "shortlist_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "scheduling_link" text;