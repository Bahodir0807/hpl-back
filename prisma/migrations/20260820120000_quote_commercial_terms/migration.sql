-- Quote-level commercial document terms captured at conversion.
-- Nullable so existing Quotes keep their historical snapshot unchanged.

ALTER TABLE "PanelQuote"
ADD COLUMN "commercialNote" TEXT,
ADD COLUMN "productionDaysFrom" INTEGER,
ADD COLUMN "productionDaysTo" INTEGER,
ADD COLUMN "deliveryDaysFrom" INTEGER,
ADD COLUMN "deliveryDaysTo" INTEGER,
ADD COLUMN "documentDate" TIMESTAMP(3);
