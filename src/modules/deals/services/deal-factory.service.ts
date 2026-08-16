import { Injectable } from '@nestjs/common';
import { DealStage, OrderItemSource, Prisma } from '@prisma/client';

const FIRST_DEAL_ACTION_SLA_MS = 2 * 60 * 60 * 1000;

export type QuoteItemForDeal = {
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
};

export type CreateDealFromQuoteInput = {
  quote: QuoteForDeal;
  clientId: string;
  projectObjectId: string | null;
  serviceProductId: string;
  userId: string;
  supplierId: string;
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
      userId,
      supplierId,
    } = input;
    const initialTaskDueDate = new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);
    const title = `КП #${quote.id.slice(0, 8)}`;

    const dealItems = quote.items.map((item) => {
      const quantityM2 = new Prisma.Decimal(item.areaM2.toString()).mul(
        item.sheetsCount,
      );
      const purchaseUsdPerM2 = this.toUsdPurchasePerM2(
        item.supplierPricePerM2,
        quote.cnyUsdRate,
      );

      return {
        productId: serviceProductId,
        quantitySheets: item.sheetsCount,
        quantityM2: quantityM2.toNumber(),
        unitPrice: item.pricePerM2,
        discount: new Prisma.Decimal(0),
        totalPrice: item.totalPrice,
        purchasePriceSnapshot: purchaseUsdPerM2,
        source: OrderItemSource.PANEL_CALCULATOR,
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

    const deal = await tx.deal.create({
      data: {
        title,
        clientId,
        projectObjectId,
        ownerId: quote.managerId,
        supplierId,
        stage: DealStage.QUALIFICATION,
        totalAmount: quote.totalAmount,
        currency: quote.displayCurrency,
        probability: 50,
        margin,
        nextActionAt: initialTaskDueDate,
        items: { create: dealItems },
      },
    });

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
        },
      },
    });

    await tx.dealOffer.create({
      data: {
        dealId: deal.id,
        version: 1,
        number: `KP-${deal.id.slice(0, 8)}-v1`,
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
