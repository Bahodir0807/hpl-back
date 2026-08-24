-- Distinguish calculator reference prices from HEAD-approved commercial prices.
-- Existing customer-facing quotes (sent/approved/converted/finalized) are treated
-- as already approved so historical PDFs stay valid. Draft quotes stay unapproved.

ALTER TABLE "PanelQuoteItem" ADD COLUMN "priceApprovedAt" TIMESTAMP(3);
ALTER TABLE "PanelQuoteItem" ADD COLUMN "priceApprovedById" TEXT;

UPDATE "PanelQuoteItem" AS item
SET "priceApprovedAt" = COALESCE(pq."finalizedAt", pq."updatedAt")
FROM "PanelQuote" AS pq
WHERE item."quoteId" = pq."id"
  AND (
    pq."finalizedAt" IS NOT NULL
    OR pq."status" IN ('sent', 'approved', 'converted')
  );
