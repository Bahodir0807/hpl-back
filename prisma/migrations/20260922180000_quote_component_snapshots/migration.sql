-- Stage 5: immutable customer-facing snapshots of approved HPL / facade /
-- installation components on each PanelQuote version. Does not recalculate
-- HPL, facade, or installation. Does not alter Stage 1–4 migrations.

CREATE TYPE "QuoteComponentKind" AS ENUM ('HPL', 'FACADE', 'INSTALLATION');

CREATE TABLE "PanelQuoteComponentSnapshot" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "kind" "QuoteComponentKind" NOT NULL,
    "sourceId" TEXT,
    "sourceRevision" INTEGER,
    "technicalRevision" INTEGER,
    "customerAmount" DECIMAL(18,8),
    "currency" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "customerSnapshot" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PanelQuoteComponentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PanelQuoteComponentSnapshot_quoteId_kind_key" ON "PanelQuoteComponentSnapshot"("quoteId", "kind");
CREATE INDEX "PanelQuoteComponentSnapshot_quoteId_sortOrder_idx" ON "PanelQuoteComponentSnapshot"("quoteId", "sortOrder");
CREATE INDEX "PanelQuoteComponentSnapshot_kind_sourceId_idx" ON "PanelQuoteComponentSnapshot"("kind", "sourceId");

ALTER TABLE "PanelQuoteComponentSnapshot" ADD CONSTRAINT "PanelQuoteComponentSnapshot_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PanelQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
