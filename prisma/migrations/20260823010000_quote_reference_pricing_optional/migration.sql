-- Automatic purchase-price calculation is reference-only for Quotes created
-- from a manager CalculationRequest. HEAD may create the draft without that
-- reference and must explicitly approve the final commercial price later.

ALTER TABLE "PanelQuoteItem"
  ALTER COLUMN "supplierPricePerM2" DROP NOT NULL,
  ALTER COLUMN "pricePerM2" DROP NOT NULL,
  ALTER COLUMN "currencyCode" DROP NOT NULL,
  ALTER COLUMN "pricePerSheet" DROP NOT NULL,
  ALTER COLUMN "totalPrice" DROP NOT NULL;
