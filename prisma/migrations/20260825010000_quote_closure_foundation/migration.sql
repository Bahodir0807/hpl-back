-- SalesPlan amounts are meaningful only together with an explicit currency.
ALTER TABLE "SalesPlan"
ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'USD';

CREATE TABLE "SalesPlanFxRate" (
    "id" TEXT NOT NULL,
    "salesPlanId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "rateToPlanCurrency" DECIMAL(18,8) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesPlanFxRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesPlanFxRate_salesPlanId_fromCurrency_key"
ON "SalesPlanFxRate"("salesPlanId", "fromCurrency");
CREATE INDEX "SalesPlanFxRate_createdById_idx"
ON "SalesPlanFxRate"("createdById");
ALTER TABLE "SalesPlanFxRate"
ADD CONSTRAINT "SalesPlanFxRate_salesPlanId_fkey"
FOREIGN KEY ("salesPlanId") REFERENCES "SalesPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesPlanFxRate"
ADD CONSTRAINT "SalesPlanFxRate_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the existing customer-facing commercialNote. New internal notes are
-- stored independently and can never be consumed by the document model.
ALTER TABLE "PanelQuote"
ADD COLUMN "internalCommercialNote" TEXT,
ADD COLUMN "productionTerms" TEXT,
ADD COLUMN "deliveryTerms" TEXT,
ADD COLUMN "previousVersionId" TEXT,
ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "PanelQuote_previousVersionId_key"
ON "PanelQuote"("previousVersionId");
CREATE UNIQUE INDEX "PanelQuote_requestId_versionNumber_key"
ON "PanelQuote"("requestId", "versionNumber");
CREATE INDEX "PanelQuote_previousVersionId_idx"
ON "PanelQuote"("previousVersionId");
ALTER TABLE "PanelQuote"
ADD CONSTRAINT "PanelQuote_previousVersionId_fkey"
FOREIGN KEY ("previousVersionId") REFERENCES "PanelQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
