-- Additive Stage-2 HEAD commercial qualification (Lead 1───0..1 LeadCommercialQualification).
-- Existing Lead rows remain valid without a commercial qualification row.
-- Do NOT backfill fake commercial qualification for historical leads.
-- CalculationSession snapshot columns are nullable so legacy calculations stay readable.

-- CreateEnum
CREATE TYPE "CommercialQualificationStatus" AS ENUM ('CONFIRMED');

-- CreateTable
CREATE TABLE "LeadCommercialQualification" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "qualityClassId" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "status" "CommercialQualificationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "decisionComment" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCommercialQualification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCommercialQualification_leadId_key" ON "LeadCommercialQualification"("leadId");

-- CreateIndex
CREATE INDEX "LeadCommercialQualification_supplierId_idx" ON "LeadCommercialQualification"("supplierId");

-- CreateIndex
CREATE INDEX "LeadCommercialQualification_qualityClassId_idx" ON "LeadCommercialQualification"("qualityClassId");

-- CreateIndex
CREATE INDEX "LeadCommercialQualification_mappingId_idx" ON "LeadCommercialQualification"("mappingId");

-- CreateIndex
CREATE INDEX "LeadCommercialQualification_confirmedById_idx" ON "LeadCommercialQualification"("confirmedById");

-- CreateIndex
CREATE INDEX "LeadCommercialQualification_status_idx" ON "LeadCommercialQualification"("status");

-- CreateIndex
CREATE INDEX "LeadCommercialQualification_confirmedAt_idx" ON "LeadCommercialQualification"("confirmedAt");

-- AddForeignKey
ALTER TABLE "LeadCommercialQualification" ADD CONSTRAINT "LeadCommercialQualification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCommercialQualification" ADD CONSTRAINT "LeadCommercialQualification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCommercialQualification" ADD CONSTRAINT "LeadCommercialQualification_qualityClassId_fkey" FOREIGN KEY ("qualityClassId") REFERENCES "QualityClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCommercialQualification" ADD CONSTRAINT "LeadCommercialQualification_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "SupplierQualityMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCommercialQualification" ADD CONSTRAINT "LeadCommercialQualification_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CalculationSession" ADD COLUMN "commercialSupplierId" TEXT;
ALTER TABLE "CalculationSession" ADD COLUMN "commercialQualityClassId" TEXT;
ALTER TABLE "CalculationSession" ADD COLUMN "commercialConfirmedAt" TIMESTAMP(3);
