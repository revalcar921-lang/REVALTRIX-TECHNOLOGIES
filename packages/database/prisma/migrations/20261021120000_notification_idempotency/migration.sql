ALTER TABLE "public"."notifications"
  ADD COLUMN "idempotencyKey" VARCHAR(300);

CREATE UNIQUE INDEX "notifications_idempotencyKey_key"
  ON "public"."notifications"("idempotencyKey");