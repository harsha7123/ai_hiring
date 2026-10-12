ALTER TABLE "interviews" ADD COLUMN "attempts_at_reset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "transcript_source" text;--> statement-breakpoint
-- Interviews completed before this migration came from the browser post or the webhook; we can't tell which, so transcript_source stays null ("unknown").
-- CV library emails are now stored lower-cased so "A@x.com" and "a@x.com" are one person. Collapse existing case-duplicates, keeping the newest.
DELETE FROM "cv_documents" a USING "cv_documents" b
WHERE a."org_id" = b."org_id"
  AND a."email" IS NOT NULL
  AND lower(trim(a."email")) = lower(trim(b."email"))
  AND (a."updated_at" < b."updated_at" OR (a."updated_at" = b."updated_at" AND a."id" < b."id"));--> statement-breakpoint
UPDATE "cv_documents" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(trim("email"));
