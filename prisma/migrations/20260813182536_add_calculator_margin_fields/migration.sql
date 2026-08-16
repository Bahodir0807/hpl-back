/*
  Warnings:

  - Added the required column `clientPricePerM2` to the `CalculationLineItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supplierPricePerM2` to the `CalculationLineItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supplierPricePerM2` to the `PanelQuoteItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CalculationLineItem" ADD COLUMN     "clientPricePerM2" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "supplierPricePerM2" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "PanelQuote" ADD COLUMN     "deliveryCost" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "PanelQuoteItem" ADD COLUMN     "supplierPricePerM2" DECIMAL(12,2) NOT NULL;
