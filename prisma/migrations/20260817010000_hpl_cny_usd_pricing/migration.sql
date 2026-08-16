-- Additive HPL pricing integrity: centralized CNY→USD rate + quote/calculation snapshots.
-- Does not rewrite existing PanelThicknessPricing amounts (those remain operationally owned).
-- Default currency for NEW catalog/calculation rows becomes CNY/USD; existing row values are unchanged.

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- Rate must be strictly positive. Pair is not constrained in SQL so the model stays additive;
-- application code only uses CNY → USD for this pass.
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_rate_positive" CHECK ("rate" > 0);

-- CreateIndex
CREATE INDEX "CurrencyRate_fromCurrency_toCurrency_effectiveFrom_idx" ON "CurrencyRate"("fromCurrency", "toCurrency", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CurrencyRate_createdById_idx" ON "CurrencyRate"("createdById");

-- AddForeignKey
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: new catalog rows are supplier CNY, not a UZS selling grid.
ALTER TABLE "PanelThicknessPricing" ALTER COLUMN "currencyCode" SET DEFAULT 'CNY';

-- AlterTable: new HPL calculations/quotes persist selling currency USD.
ALTER TABLE "CalculationSession" ALTER COLUMN "displayCurrency" SET DEFAULT 'USD';
ALTER TABLE "PanelQuote" ALTER COLUMN "displayCurrency" SET DEFAULT 'USD';

-- AlterTable: historical FX/coefficient snapshot so later rate changes cannot rewrite old quotes.
ALTER TABLE "CalculationSession" ADD COLUMN "cnyUsdRate" DECIMAL(18,8);
ALTER TABLE "CalculationSession" ADD COLUMN "sellingCoefficient" DECIMAL(8,4);
ALTER TABLE "PanelQuote" ADD COLUMN "cnyUsdRate" DECIMAL(18,8);
ALTER TABLE "PanelQuote" ADD COLUMN "sellingCoefficient" DECIMAL(8,4);
