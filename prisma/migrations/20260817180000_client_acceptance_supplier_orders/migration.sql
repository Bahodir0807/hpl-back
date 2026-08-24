-- BUSINESS PASS 5: Quote client acceptance, Deal 1:N SupplierOrder,
-- production timeline, and idempotent readiness reminder claims.
-- Historical Quotes stay unaccepted (NULL). Existing SupplierOrders stay valid.
-- Do NOT backfill client acceptance or ready confirmation.

-- AlterTable PanelQuote: explicit customer-acceptance fact (not HEAD approval)
ALTER TABLE "PanelQuote" ADD COLUMN "clientAcceptedAt" TIMESTAMP(3);
ALTER TABLE "PanelQuote" ADD COLUMN "clientAcceptedById" TEXT;

-- AlterTable SupplierOrder: drop 1:1 uniqueness, add timeline / actor metadata
DROP INDEX "SupplierOrder_dealId_key";

ALTER TABLE "SupplierOrder" ADD COLUMN "orderedAt" TIMESTAMP(3);
ALTER TABLE "SupplierOrder" ADD COLUMN "expectedReadyAt" TIMESTAMP(3);
ALTER TABLE "SupplierOrder" ADD COLUMN "expectedShipmentAt" TIMESTAMP(3);
ALTER TABLE "SupplierOrder" ADD COLUMN "expectedArrivalAt" TIMESTAMP(3);
ALTER TABLE "SupplierOrder" ADD COLUMN "comment" TEXT;
ALTER TABLE "SupplierOrder" ADD COLUMN "createdById" TEXT;
ALTER TABLE "SupplierOrder" ADD COLUMN "readyConfirmedAt" TIMESTAMP(3);
ALTER TABLE "SupplierOrder" ADD COLUMN "readyConfirmedById" TEXT;

CREATE INDEX "SupplierOrder_dealId_idx" ON "SupplierOrder"("dealId");
CREATE INDEX "SupplierOrder_expectedReadyAt_idx" ON "SupplierOrder"("expectedReadyAt");
CREATE INDEX "SupplierOrder_createdById_idx" ON "SupplierOrder"("createdById");
CREATE INDEX "SupplierOrder_readyConfirmedById_idx" ON "SupplierOrder"("readyConfirmedById");
CREATE INDEX "PanelQuote_clientAcceptedById_idx" ON "PanelQuote"("clientAcceptedById");

ALTER TABLE "PanelQuote" ADD CONSTRAINT "PanelQuote_clientAcceptedById_fkey" FOREIGN KEY ("clientAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_readyConfirmedById_fkey" FOREIGN KEY ("readyConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: deterministic reminder claims (SupplierOrder + kind + calendar date)
CREATE TABLE "SupplierOrderReminderClaim" (
    "id" TEXT NOT NULL,
    "supplierOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reminderDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOrderReminderClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierOrderReminderClaim_supplierOrderId_kind_reminderDate_key" ON "SupplierOrderReminderClaim"("supplierOrderId", "kind", "reminderDate");
CREATE INDEX "SupplierOrderReminderClaim_reminderDate_idx" ON "SupplierOrderReminderClaim"("reminderDate");

ALTER TABLE "SupplierOrderReminderClaim" ADD CONSTRAINT "SupplierOrderReminderClaim_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
