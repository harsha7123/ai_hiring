CREATE TABLE "cv_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"file_name" text NOT NULL,
	"file_mime" text NOT NULL,
	"file_data" "bytea",
	"cv_text" text,
	"profile" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "cv_document_id" uuid;--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_documents_org_idx" ON "cv_documents" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cv_documents_org_email_uq" ON "cv_documents" USING btree ("org_id","email");--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE set null ON UPDATE no action;