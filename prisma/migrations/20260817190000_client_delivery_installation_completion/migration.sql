-- BUSINESS PASS 6: client delivery confirmation, DealInstallation,
-- and operational Deal.completedAt (distinct from commercial WON).
-- Historical Deals stay incomplete (NULL completedAt).
-- Do NOT backfill Installation jobs or delivery/confirmation actors.

-- AlterEnum ActivityType
ALTER TYPE "ActivityType" ADD VALUE 'CLIENT_DELIVERY_CONFIRMED';
ALTER TYPE "ActivityType" ADD VALUE 'INSTALLATION_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'DEAL_COMPLETED';

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable Deal: operational completion timestamp (not a new DealStage)
ALTER TABLE "Deal" ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE INDEX "Deal_completedAt_idx" ON "Deal"("completedAt");

-- AlterTable SupplierOrder: actual client-delivery confirmation
ALTER TABLE "SupplierOrder" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "SupplierOrder" ADD COLUMN "deliveredById" TEXT;
CREATE INDEX "SupplierOrder_deliveredById_idx" ON "SupplierOrder"("deliveredById");
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable DealInstallation (1:1 with Deal, lazy-created when scheduled)
CREATE TABLE "DealInstallation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" "InstallationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "expectedInstallationAt" TIMESTAMP(3),
    "expectedCompletionAt" TIMESTAMP(3),
    "assessmentComment" TEXT,
    "workComment" TEXT,
    "assessedAt" TIMESTAMP(3),
    "assessedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "installerConfirmedAt" TIMESTAMP(3),
    "installerConfirmedById" TEXT,
    "supervisorConfirmedAt" TIMESTAMP(3),
    "supervisorConfirmedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealInstallation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealInstallation_dealId_key" ON "DealInstallation"("dealId");
CREATE INDEX "DealInstallation_status_idx" ON "DealInstallation"("status");
CREATE INDEX "DealInstallation_assessedById_idx" ON "DealInstallation"("assessedById");
CREATE INDEX "DealInstallation_startedById_idx" ON "DealInstallation"("startedById");
CREATE INDEX "DealInstallation_installerConfirmedById_idx" ON "DealInstallation"("installerConfirmedById");
CREATE INDEX "DealInstallation_supervisorConfirmedById_idx" ON "DealInstallation"("supervisorConfirmedById");
CREATE INDEX "DealInstallation_completedAt_idx" ON "DealInstallation"("completedAt");

ALTER TABLE "DealInstallation" ADD CONSTRAINT "DealInstallation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealInstallation" ADD CONSTRAINT "DealInstallation_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DealInstallation" ADD CONSTRAINT "DealInstallation_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DealInstallation" ADD CONSTRAINT "DealInstallation_installerConfirmedById_fkey" FOREIGN KEY ("installerConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DealInstallation" ADD CONSTRAINT "DealInstallation_supervisorConfirmedById_fkey" FOREIGN KEY ("supervisorConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
