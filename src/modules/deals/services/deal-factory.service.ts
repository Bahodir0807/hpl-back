import { Injectable } from '@nestjs/common';
import {
  DealStage,
  FulfillmentSource,
  OrderItemSource,
  Prisma,
} from '@prisma/client';

const FIRST_DEAL_ACTION_SLA_MS = 2 * 60 * 60 * 1000;

export type QuoteItemForDeal = {
  id: string;
  areaM2: Prisma.Decimal;
  sheetsCount: number;
  pricePerM2: Prisma.Decimal;
  supplierPricePerM2: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
};

export type QuoteForDeal = {
  id: string;
  managerId: string;
  totalAmount: Prisma.Decimal;
  displayCurrency: string;
  validUntil: Date;
  deliveryCost?: Prisma.Decimal | null;
  cnyUsdRate?: Prisma.Decimal | null;
  sellingCoefficient?: Prisma.Decimal | null;
  items: QuoteItemForDeal[];
  versionNumber?: number;
};

export type CreateDealFromQuoteInput = {
  quote: QuoteForDeal;
  clientId: string;
  projectObjectId: string | null;
  serviceProductId: string;
  resolvedProductIds?: Record<string, string>;
  fulfillmentSource: FulfillmentSource;
  installationRequiredSnapshot: boolean;
  userId: string;
  supplierId: string;
  existingDealId?: string;
};

@Injectable()
export class DealFactory {
  async createFromQuote(
    tx: Prisma.TransactionClient,
    input: CreateDealFromQuoteInput,
  ): Promise<{ id: string; title: string }> {
    const {
      quote,
      clientId,
      projectObjectId,
      serviceProductId,
      resolvedProductIds,
      fulfillmentSource,
      installationRequiredSnapshot,
      userId,
      supplierId,
      existingDealId,
    } = input;
    const initialTaskDueDate = new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);
    const title = `КП #${quote.id.slice(0, 8)}`;

    if (
      fulfillmentSource === FulfillmentSource.WAREHOUSE_STOCK &&
      quote.items.some((item) => !resolvedProductIds?.[item.id])
    ) {
      throw new Error(
        'Warehouse-stock Deal requires a resolved SKU for every Quote line',
      );
    }

    const dealItems = quote.items.map((item) => {
      const quantityM2 = new Prisma.Decimal(item.areaM2.toString()).mul(
        item.sheetsCount,
      );
      const purchaseUsdPerM2 = this.toUsdPurchasePerM2(
        item.supplierPricePerM2,
        quote.cnyUsdRate,
      );

      return {
        productId: resolvedProductIds?.[item.id] ?? serviceProductId,
        quantitySheets: item.sheetsCount,
        quantityM2: quantityM2.toNumber(),
        unitPrice: item.pricePerM2,
        discount: new Prisma.Decimal(0),
        totalPrice: item.totalPrice,
        purchasePriceSnapshot: purchaseUsdPerM2,
        source:
          fulfillmentSource === FulfillmentSource.WAREHOUSE_STOCK
            ? OrderItemSource.SKU
            : OrderItemSource.PANEL_CALCULATOR,
      };
    });

    const purchaseCost = quote.items.reduce((sum, item) => {
      const quantityM2 = new Prisma.Decimal(item.areaM2.toString()).mul(
        item.sheetsCount,
      );
      const purchaseUsdPerM2 = this.toUsdPurchasePerM2(
        item.supplierPricePerM2,
        quote.cnyUsdRate,
      );

      return sum.plus(quantityM2.mul(purchaseUsdPerM2));
    }, new Prisma.Decimal(0));

    const margin = new Prisma.Decimal(quote.totalAmount.toString()).minus(
      purchaseCost,
    );

    const dealData = {
      title,
      clientId,
      projectObjectId,
      ownerId: quote.managerId,
      supplierId,
      fulfillmentSource,
      installationRequiredSnapshot,
      stage: DealStage.QUALIFICATION,
      totalAmount: quote.totalAmount,
      currency: quote.displayCurrency,
      probability: 50,
      margin,
      nextActionAt: initialTaskDueDate,
      items: { create: dealItems },
    };
    const deal = existingDealId
      ? await tx.deal.update({
          where: { id: existingDealId },
          data: { ...dealData, stage: undefined },
        })
      : await tx.deal.create({ data: dealData });

    if (!existingDealId)
      await tx.dealStageHistory.create({
        data: {
          dealId: deal.id,
          oldStage: null,
          newStage: DealStage.QUALIFICATION,
          changedById: userId,
        },
      });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        entityType: 'Deal',
        entityId: deal.id,
        newValue: {
          title,
          stage: DealStage.QUALIFICATION,
          quoteId: quote.id,
          source: 'panel_quote',
          fulfillmentSource,
        },
      },
    });

    await tx.dealOffer.create({
      data: {
        dealId: deal.id,
        version: quote.versionNumber ?? 1,
        number: `KP-${deal.id.slice(0, 8)}-v${quote.versionNumber ?? 1}`,
        amount: quote.totalAmount,
        validUntil: quote.validUntil,
        isApproved: false,
      },
    });

    return { id: deal.id, title: deal.title };
  }

  private toUsdPurchasePerM2(
    supplierPricePerM2: Prisma.Decimal,
    cnyUsdRate?: Prisma.Decimal | null,
  ): Prisma.Decimal {
    const supplier = new Prisma.Decimal(supplierPricePerM2.toString());
    if (!cnyUsdRate || new Prisma.Decimal(cnyUsdRate.toString()).lte(0)) {
      return supplier.toDecimalPlaces(2);
    }

    return supplier.mul(cnyUsdRate).toDecimalPlaces(2);
  }
}
