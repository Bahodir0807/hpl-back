-- Warehouse purchasing extends ExpectedReceipt instead of creating a parallel stock ledger.
ALTER TABLE "ExpectedReceipt"
  ADD COLUMN "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "createdById" TEXT;

CREATE TABLE "ExpectedReceiptEvent" (
  "id" TEXT NOT NULL,
  "expectedReceiptId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" TEXT NOT NULL,
  "comment" TEXT,
  "clientReceiptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpectedReceiptEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpectedReceiptEventItem" (
  "id" TEXT NOT NULL,
  "receiptEventId" TEXT NOT NULL,
  "expectedReceiptItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "acceptedQuantity" DOUBLE PRECISION NOT NULL,
  "rejectedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpectedReceiptEventItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpectedReceipt_createdById_idx" ON "ExpectedReceipt"("createdById");
CREATE INDEX "ExpectedReceipt_orderedAt_idx" ON "ExpectedReceipt"("orderedAt");
CREATE UNIQUE INDEX "ExpectedReceiptEvent_expectedReceiptId_clientReceiptId_key" ON "ExpectedReceiptEvent"("expectedReceiptId", "clientReceiptId");
CREATE INDEX "ExpectedReceiptEvent_expectedReceiptId_idx" ON "ExpectedReceiptEvent"("expectedReceiptId");
CREATE INDEX "ExpectedReceiptEvent_receivedById_idx" ON "ExpectedReceiptEvent"("receivedById");
CREATE INDEX "ExpectedReceiptEvent_receivedAt_idx" ON "ExpectedReceiptEvent"("receivedAt");
CREATE INDEX "ExpectedReceiptEventItem_receiptEventId_idx" ON "ExpectedReceiptEventItem"("receiptEventId");
CREATE INDEX "ExpectedReceiptEventItem_expectedReceiptItemId_idx" ON "ExpectedReceiptEventItem"("expectedReceiptItemId");
CREATE INDEX "ExpectedReceiptEventItem_productId_idx" ON "ExpectedReceiptEventItem"("productId");

ALTER TABLE "ExpectedReceipt"
  ADD CONSTRAINT "ExpectedReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExpectedReceiptEvent"
  ADD CONSTRAINT "ExpectedReceiptEvent_expectedReceiptId_fkey" FOREIGN KEY ("expectedReceiptId") REFERENCES "ExpectedReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ExpectedReceiptEvent_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpectedReceiptEventItem"
  ADD CONSTRAINT "ExpectedReceiptEventItem_receiptEventId_fkey" FOREIGN KEY ("receiptEventId") REFERENCES "ExpectedReceiptEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ExpectedReceiptEventItem_expectedReceiptItemId_fkey" FOREIGN KEY ("expectedReceiptItemId") REFERENCES "ExpectedReceiptItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExpectedReceiptEventItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
