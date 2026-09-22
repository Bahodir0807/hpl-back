-- Stage 3: supplier offers and facade subsystem commercial calculation.
-- Does not change HPL Calculation / PanelQuote / Deal / CNY×FX×2.

CREATE TYPE "FacadeCommercialStatus" AS ENUM ('DRAFT', 'READY_FOR_APPROVAL', 'APPROVED');

CREATE TABLE "FacadeMaterialSupplierOffer" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchasePrice" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "availability" TEXT,
    "leadTimeDays" INTEGER,
    "supplierSku" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacadeMaterialSupplierOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacadeMaterialSupplierOffer_materialId_isActive_idx" ON "FacadeMaterialSupplierOffer"("materialId", "isActive");
CREATE INDEX "FacadeMaterialSupplierOffer_supplierId_idx" ON "FacadeMaterialSupplierOffer"("supplierId");

ALTER TABLE "FacadeMaterialSupplierOffer"
  ADD CONSTRAINT "FacadeMaterialSupplierOffer_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "FacadeMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeMaterialSupplierOffer"
  ADD CONSTRAINT "FacadeMaterialSupplierOffer_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FacadeCommercialCalculation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "facadeCalculationId" TEXT NOT NULL,
    "facadeCalculationRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "FacadeCommercialStatus" NOT NULL DEFAULT 'DRAFT',
    "technicalSnapshot" JSONB NOT NULL,
    "procurementIncomplete" BOOLEAN NOT NULL DEFAULT true,
    "procurementByCurrency" JSONB NOT NULL,
    "fxSnapshots" JSONB NOT NULL,
    "proposedCustomerAmount" DECIMAL(18,8),
    "proposedCurrency" TEXT,
    "approvedCustomerAmount" DECIMAL(18,8),
    "approvedCurrency" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approverRoleSnapshot" TEXT,
    "commercialNote" TEXT,
    "quoteCreated" BOOLEAN NOT NULL DEFAULT false,
    "dealCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacadeCommercialCalculation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeCommercialCalculation_leadId_revision_key" ON "FacadeCommercialCalculation"("leadId", "revision");
CREATE INDEX "FacadeCommercialCalculation_leadId_isCurrent_idx" ON "FacadeCommercialCalculation"("leadId", "isCurrent");
CREATE INDEX "FacadeCommercialCalculation_facadeCalculationId_idx" ON "FacadeCommercialCalculation"("facadeCalculationId");
CREATE INDEX "FacadeCommercialCalculation_status_idx" ON "FacadeCommercialCalculation"("status");

ALTER TABLE "FacadeCommercialCalculation"
  ADD CONSTRAINT "FacadeCommercialCalculation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacadeCommercialCalculation"
  ADD CONSTRAINT "FacadeCommercialCalculation_facadeCalculationId_fkey"
  FOREIGN KEY ("facadeCalculationId") REFERENCES "FacadeSubsystemCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacadeCommercialCalculation"
  ADD CONSTRAINT "FacadeCommercialCalculation_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FacadeCommercialCalculationItem" (
    "id" TEXT NOT NULL,
    "commercialCalculationId" TEXT NOT NULL,
    "technicalItemId" TEXT,
    "materialId" TEXT,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "materialSnapshot" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "finalQty" DECIMAL(18,8) NOT NULL,
    "excludedFromSubsystemCommercialCost" BOOLEAN NOT NULL DEFAULT false,
    "selectedOfferId" TEXT,
    "offerSnapshot" JSONB,
    "purchasePrice" DECIMAL(18,8),
    "purchaseCurrency" TEXT,
    "linePurchaseTotal" DECIMAL(18,8),
    "priceStatus" TEXT NOT NULL,
    "fxFromCurrency" TEXT,
    "fxToCurrency" TEXT,
    "fxRate" DECIMAL(18,8),
    "fxRateId" TEXT,
    "fxEffectiveFrom" TIMESTAMP(3),
    "convertedAmount" DECIMAL(18,8),
    "convertedCurrency" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacadeCommercialCalculationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacadeCommercialCalculationItem_commercialCalculationId_sortOrder_idx"
  ON "FacadeCommercialCalculationItem"("commercialCalculationId", "sortOrder");

ALTER TABLE "FacadeCommercialCalculationItem"
  ADD CONSTRAINT "FacadeCommercialCalculationItem_commercialCalculationId_fkey"
  FOREIGN KEY ("commercialCalculationId") REFERENCES "FacadeCommercialCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FacadeCommercialCalculationRevision" (
    "id" TEXT NOT NULL,
    "commercialCalculationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacadeCommercialCalculationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacadeCommercialCalculationRevision_commercialCalculationId_createdAt_idx"
  ON "FacadeCommercialCalculationRevision"("commercialCalculationId", "createdAt");

ALTER TABLE "FacadeCommercialCalculationRevision"
  ADD CONSTRAINT "FacadeCommercialCalculationRevision_commercialCalculationId_fkey"
  FOREIGN KEY ("commercialCalculationId") REFERENCES "FacadeCommercialCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacadeCommercialCalculationRevision"
  ADD CONSTRAINT "FacadeCommercialCalculationRevision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
