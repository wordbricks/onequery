CREATE TABLE "rate_limit" (
	"count" integer NOT NULL,
	"key" text NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit" USING btree ("key");