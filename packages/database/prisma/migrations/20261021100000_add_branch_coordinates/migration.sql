ALTER TABLE "public"."branches"
  ADD COLUMN "latitude" DECIMAL(9, 6),
  ADD COLUMN "longitude" DECIMAL(9, 6);

ALTER TABLE "public"."branches"
  ADD CONSTRAINT "branches_coordinates_pair_check"
    CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "branches_latitude_range_check"
    CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "branches_longitude_range_check"
    CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

CREATE INDEX "branches_latitude_longitude_idx"
  ON "public"."branches"("latitude", "longitude");