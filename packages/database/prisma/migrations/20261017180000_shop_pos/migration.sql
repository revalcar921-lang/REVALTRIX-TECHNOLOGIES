DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'SaleStatus' AND n.nspname = 'public') THEN CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'SalePaymentMethod' AND n.nspname = 'public') THEN CREATE TYPE "SalePaymentMethod" AS ENUM ('CASH', 'MPESA_STK_PUSH', 'CARD', 'BANK_TRANSFER', 'CREDIT_ACCOUNT'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'SalePaymentStatus' AND n.nspname = 'public') THEN CREATE TYPE "SalePaymentStatus" AS ENUM ('PAID', 'PENDING', 'REFUNDED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'StockMovementType' AND n.nspname = 'public') THEN CREATE TYPE "StockMovementType" AS ENUM ('SALE', 'REFUND', 'RECEIVE'); END IF; END $$;

ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS "genericName" VARCHAR(200),
    ADD COLUMN IF NOT EXISTS "strength" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "dosageForm" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "packSize" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "manufacturer" VARCHAR(150),
    ADD COLUMN IF NOT EXISTS "ppbRegistrationNo" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "storageCondition" VARCHAR(50) DEFAULT 'ROOM_TEMP';

CREATE TABLE IF NOT EXISTS "product_batches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "batchNumber" VARCHAR(100) NOT NULL,
    "expiryDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "supplierName" VARCHAR(200),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashierUserId" UUID NOT NULL,
    "saleNumber" VARCHAR(100) NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "paymentStatus" "SalePaymentStatus" NOT NULL DEFAULT 'PAID',
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "changeDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customerName" VARCHAR(200),
    "customerPhone" VARCHAR(50),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sale_items" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "productName" VARCHAR(200) NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "batchNumber" VARCHAR(100) NOT NULL,
    "expiryDate" DATE NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sale_payments" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "method" "SalePaymentMethod" NOT NULL,
    "status" "SalePaymentStatus" NOT NULL DEFAULT 'PAID',
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sale_refunds" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "cashierUserId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "stockReturned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "held_shop_sales" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashierUserId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "held_shop_sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "saleId" UUID,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_tenantId_saleNumber_key" ON "sales"("tenantId", "saleNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "product_batches_tenantId_productId_batchNumber_key" ON "product_batches"("tenantId", "productId", "batchNumber");
CREATE INDEX IF NOT EXISTS "product_batches_tenantId_expiryDate_idx" ON "product_batches"("tenantId", "expiryDate");
CREATE INDEX IF NOT EXISTS "sales_tenantId_createdAt_idx" ON "sales"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "sales_tenantId_status_createdAt_idx" ON "sales"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "sale_items_saleId_idx" ON "sale_items"("saleId");
CREATE INDEX IF NOT EXISTS "sale_items_productId_batchId_idx" ON "sale_items"("productId", "batchId");
CREATE INDEX IF NOT EXISTS "sale_payments_saleId_idx" ON "sale_payments"("saleId");
CREATE INDEX IF NOT EXISTS "sale_refunds_tenantId_createdAt_idx" ON "sale_refunds"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "sale_refunds_saleId_idx" ON "sale_refunds"("saleId");
CREATE INDEX IF NOT EXISTS "held_shop_sales_tenantId_cashierUserId_createdAt_idx" ON "held_shop_sales"("tenantId", "cashierUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_productId_batchId_createdAt_idx" ON "stock_movements"("productId", "batchId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_saleId_idx" ON "stock_movements"("saleId");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_tenantId_fkey' AND conrelid = 'sales'::regclass) THEN ALTER TABLE "sales" ADD CONSTRAINT "sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_cashierUserId_fkey' AND conrelid = 'sales'::regclass) THEN ALTER TABLE "sales" ADD CONSTRAINT "sales_cashierUserId_fkey" FOREIGN KEY ("cashierUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_batches_tenantId_fkey' AND conrelid = 'product_batches'::regclass) THEN ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_batches_productId_fkey' AND conrelid = 'product_batches'::regclass) THEN ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_saleId_fkey' AND conrelid = 'sale_items'::regclass) THEN ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_productId_fkey' AND conrelid = 'sale_items'::regclass) THEN ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_batchId_fkey' AND conrelid = 'sale_items'::regclass) THEN ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_saleId_fkey' AND conrelid = 'sale_payments'::regclass) THEN ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_refunds_tenantId_fkey' AND conrelid = 'sale_refunds'::regclass) THEN ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_refunds_saleId_fkey' AND conrelid = 'sale_refunds'::regclass) THEN ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_refunds_cashierUserId_fkey' AND conrelid = 'sale_refunds'::regclass) THEN ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_cashierUserId_fkey" FOREIGN KEY ("cashierUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'held_shop_sales_tenantId_fkey' AND conrelid = 'held_shop_sales'::regclass) THEN ALTER TABLE "held_shop_sales" ADD CONSTRAINT "held_shop_sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'held_shop_sales_cashierUserId_fkey' AND conrelid = 'held_shop_sales'::regclass) THEN ALTER TABLE "held_shop_sales" ADD CONSTRAINT "held_shop_sales_cashierUserId_fkey" FOREIGN KEY ("cashierUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_tenantId_fkey' AND conrelid = 'stock_movements'::regclass) THEN ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_userId_fkey' AND conrelid = 'stock_movements'::regclass) THEN ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_productId_fkey' AND conrelid = 'stock_movements'::regclass) THEN ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_batchId_fkey' AND conrelid = 'stock_movements'::regclass) THEN ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_saleId_fkey' AND conrelid = 'stock_movements'::regclass) THEN ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
