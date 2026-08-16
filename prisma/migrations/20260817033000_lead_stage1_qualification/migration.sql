-- Additive Stage-1 HPL customer-need qualification (Lead 1───0..1 LeadQualification).
-- Existing Lead rows remain valid without a qualification row.
-- installationRequired is nullable on purpose: unknown must stay unknown.
-- Do NOT backfill installationRequired=false for historical leads.

-- CreateEnum
CREATE TYPE "HplApplication" AS ENUM ('INTERIOR', 'EXTERIOR');

-- CreateTable
CREATE TABLE "LeadQualification" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "application" "HplApplication",
    "panelTypeId" TEXT,
    "thicknessMm" INTEGER,
    "panelSizeId" TEXT,
    "customWidthMm" INTEGER,
    "customHeightMm" INTEGER,
    "colorCode" TEXT,
    "colorName" TEXT,
    "requiredAreaM2" DECIMAL(10,4),
    "installationRequired" BOOLEAN,
    "stockOnly" BOOLEAN,
    "urgent" BOOLEAN,
    "willingToWait" BOOLEAN,
    "customerRequirements" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadQualification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_requiredAreaM2_positive" CHECK ("requiredAreaM2" IS NULL OR "requiredAreaM2" > 0);
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_thicknessMm_positive" CHECK ("thicknessMm" IS NULL OR "thicknessMm" > 0);
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_customWidthMm_positive" CHECK ("customWidthMm" IS NULL OR "customWidthMm" > 0);
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_customHeightMm_positive" CHECK ("customHeightMm" IS NULL OR "customHeightMm" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "LeadQualification_leadId_key" ON "LeadQualification"("leadId");

-- CreateIndex
CREATE INDEX "LeadQualification_application_idx" ON "LeadQualification"("application");

-- CreateIndex
CREATE INDEX "LeadQualification_panelTypeId_idx" ON "LeadQualification"("panelTypeId");

-- CreateIndex
CREATE INDEX "LeadQualification_panelSizeId_idx" ON "LeadQualification"("panelSizeId");

-- CreateIndex
CREATE INDEX "LeadQualification_installationRequired_idx" ON "LeadQualification"("installationRequired");

-- CreateIndex
CREATE INDEX "LeadQualification_stockOnly_idx" ON "LeadQualification"("stockOnly");

-- CreateIndex
CREATE INDEX "LeadQualification_urgent_idx" ON "LeadQualification"("urgent");

-- AddForeignKey
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_panelTypeId_fkey" FOREIGN KEY ("panelTypeId") REFERENCES "PanelType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadQualification" ADD CONSTRAINT "LeadQualification_panelSizeId_fkey" FOREIGN KEY ("panelSizeId") REFERENCES "PanelSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;
