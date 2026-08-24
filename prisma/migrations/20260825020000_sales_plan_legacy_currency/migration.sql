-- The previous migration introduced the field structurally. Existing plan
-- amounts have no trustworthy currency snapshot, so they must be explicitly
-- completed by a Director instead of being silently interpreted as USD.
ALTER TABLE "SalesPlan" ALTER COLUMN "currencyCode" DROP DEFAULT;
ALTER TABLE "SalesPlan" ALTER COLUMN "currencyCode" DROP NOT NULL;
UPDATE "SalesPlan" SET "currencyCode" = NULL;
