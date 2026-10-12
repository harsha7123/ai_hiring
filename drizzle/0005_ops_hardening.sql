CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "cv_documents" ADD COLUMN "file_path" text;