CREATE TYPE "public"."interview_mode" AS ENUM('in_browser', 'phone_call');--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "interview_mode" "interview_mode" DEFAULT 'in_browser' NOT NULL;