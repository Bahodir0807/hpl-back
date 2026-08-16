-- CreateEnum
CREATE TYPE "OrderItemSource" AS ENUM ('SKU', 'PANEL_CALCULATOR');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'SUPPLIER_ORDER_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "DealItem" ADD COLUMN     "source" "OrderItemSource" NOT NULL DEFAULT 'SKU';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "source" "OrderItemSource" NOT NULL DEFAULT 'SKU';

-- CreateIndex
CREATE INDEX "Deal_supplierId_idx" ON "Deal"("supplierId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
