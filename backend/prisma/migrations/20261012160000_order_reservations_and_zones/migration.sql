-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "reservedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fee" DECIMAL(10,2) NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCounter" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_name_key" ON "DeliveryZone"("name");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCounter_date_key" ON "OrderCounter"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
