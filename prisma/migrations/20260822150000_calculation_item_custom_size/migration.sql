-- Persist manager-entered custom panel dimensions on calculation items and
-- Quote snapshots. sheetsCount already exists; decor remains colorId/colorName.

ALTER TABLE "CalculationLineItem" ADD COLUMN "customWidthMm" INTEGER;
ALTER TABLE "CalculationLineItem" ADD COLUMN "customHeightMm" INTEGER;

ALTER TABLE "PanelQuoteItem" ADD COLUMN "customWidthMm" INTEGER;
ALTER TABLE "PanelQuoteItem" ADD COLUMN "customHeightMm" INTEGER;
