ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'PACKING';
ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "ShopOrderStatus" ADD VALUE IF NOT EXISTS 'RETURNED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'ShopOrderType' AND n.nspname = 'public') THEN
    CREATE TYPE "ShopOrderType" AS ENUM (
  'WALK_IN',
  'ONLINE',
  'PICKUP',
  'DELIVERY',
  'PRESCRIPTION',
  'WHOLESALE',
  'HOSPITAL'
);
  END IF;
END
$$;

ALTER TABLE "shop_orders"
  ADD COLUMN "branchId" UUID,
  ADD COLUMN "customerId" UUID,
  ADD COLUMN "prescriptionId" UUID,
  ADD COLUMN "orderType" "ShopOrderType" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "fulfilmentStatus" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "paymentMethod" VARCHAR(40),
  ADD COLUMN "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pickupAt" TIMESTAMPTZ(6),
  ADD COLUMN "notes" VARCHAR(2000),
  ADD COLUMN "assignedStaffId" UUID,
  ADD COLUMN "assignedRiderId" UUID,
  ADD COLUMN "deliveryNotes" VARCHAR(2000),
  ADD COLUMN "failedDeliveryReason" VARCHAR(500);

UPDATE "shop_orders" SET "fulfilmentStatus" = "status";

ALTER TABLE "shop_order_items"
  ADD COLUMN "batchId" UUID,
  ADD COLUMN "unit" VARCHAR(40) NOT NULL DEFAULT 'unit',
  ADD COLUMN "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "shop_order_payments" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "method" VARCHAR(40) NOT NULL,
  "status" "ShopPaymentStatus" NOT NULL DEFAULT 'PAID',
  "reference" VARCHAR(200),
  "isRefund" BOOLEAN NOT NULL DEFAULT false,
  "stockReturned" BOOLEAN NOT NULL DEFAULT false,
  "reason" VARCHAR(500),
  "recordedById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_order_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_order_status_history" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "fromStatus" "ShopOrderStatus",
  "toStatus" "ShopOrderStatus" NOT NULL,
  "actorUserId" UUID,
  "notes" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_order_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_deliveries" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "riderId" UUID,
  "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "address" JSONB,
  "customerPhone" VARCHAR(50) NOT NULL,
  "notes" VARCHAR(2000),
  "failedDeliveryReason" VARCHAR(500),
  "returnedToStock" BOOLEAN NOT NULL DEFAULT false,
  "deliveredAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "shop_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_delivery_proofs" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "storageKey" VARCHAR(1000) NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "uploadedById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_delivery_proofs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stock_movements" ADD COLUMN "shopOrderId" UUID;

CREATE INDEX "shop_orders_tenantId_branchId_createdAt_idx"
  ON "shop_orders"("tenantId", "branchId", "createdAt");
CREATE INDEX "shop_orders_tenantId_customerId_idx"
  ON "shop_orders"("tenantId", "customerId");
CREATE INDEX "shop_order_items_batchId_idx" ON "shop_order_items"("batchId");
CREATE INDEX "shop_order_payments_tenantId_orderId_createdAt_idx"
  ON "shop_order_payments"("tenantId", "orderId", "createdAt");
CREATE INDEX "shop_order_status_history_tenantId_orderId_createdAt_idx"
  ON "shop_order_status_history"("tenantId", "orderId", "createdAt");
CREATE INDEX "shop_deliveries_tenantId_orderId_createdAt_idx"
  ON "shop_deliveries"("tenantId", "orderId", "createdAt");
CREATE INDEX "shop_deliveries_tenantId_riderId_idx"
  ON "shop_deliveries"("tenantId", "riderId");
CREATE INDEX "shop_delivery_proofs_deliveryId_createdAt_idx"
  ON "shop_delivery_proofs"("deliveryId", "createdAt");
CREATE INDEX "stock_movements_shopOrderId_idx" ON "stock_movements"("shopOrderId");

ALTER TABLE "shop_order_items"
  ADD CONSTRAINT "shop_order_items_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shop_order_payments"
  ADD CONSTRAINT "shop_order_payments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_order_payments"
  ADD CONSTRAINT "shop_order_payments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_order_status_history"
  ADD CONSTRAINT "shop_order_status_history_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_order_status_history"
  ADD CONSTRAINT "shop_order_status_history_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_deliveries"
  ADD CONSTRAINT "shop_deliveries_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_deliveries"
  ADD CONSTRAINT "shop_deliveries_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_delivery_proofs"
  ADD CONSTRAINT "shop_delivery_proofs_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "shop_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_shopOrderId_fkey"
  FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
