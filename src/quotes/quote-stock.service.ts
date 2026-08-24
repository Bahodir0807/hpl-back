import { Injectable } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../modules/prisma/prisma.service';

export type QuoteStockSnapshotItem = {
  id: string;
  areaM2: Prisma.Decimal;
  thicknessMm: Prisma.Decimal | number;
  supplierCode: string;
  colorCode: string | null;
  colorName: string | null;
  panelSizeName: string;
  panelTypeCode: string;
  qualityClassCode: string;
  application?: string | null;
  sheetsCount: number;
};

export type QuoteStockLine = {
  quoteItemId: string;
  productId: string | null;
  sku: string | null;
  requiredQuantity: number;
  availableQuantity: number;
  shortage: number;
  resolution:
    | 'RESOLVED'
    | 'NO_MATCH'
    | 'AMBIGUOUS_MATCH'
    | 'UNSUPPORTED_UNIT'
    | 'UNREPRESENTABLE_SPEC'
    | 'UNSAFE_COLOR_IDENTITY';
};

export type QuoteStockAvailability = {
  status: 'SUFFICIENT' | 'INSUFFICIENT' | 'SKU_UNRESOLVED';
  lines: QuoteStockLine[];
};

@Injectable()
export class QuoteStockService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    items: QuoteStockSnapshotItem[],
  ): Promise<QuoteStockAvailability> {
    const lines = await Promise.all(
      items.map((item) => this.resolveLine(item)),
    );
    const requiredByProduct = new Map<string, number>();

    for (const line of lines) {
      if (line.productId && line.resolution === 'RESOLVED') {
        requiredByProduct.set(
          line.productId,
          (requiredByProduct.get(line.productId) ?? 0) + line.requiredQuantity,
        );
      }
    }

    const aggregatedLines = lines.map((line) => {
      if (!line.productId || line.resolution !== 'RESOLVED') return line;
      const required = requiredByProduct.get(line.productId) ?? 0;
      return {
        ...line,
        shortage: Math.max(0, required - line.availableQuantity),
      };
    });

    if (aggregatedLines.some((line) => line.resolution !== 'RESOLVED')) {
      return { status: 'SKU_UNRESOLVED', lines: aggregatedLines };
    }

    return {
      status: aggregatedLines.some((line) => line.shortage > 0)
        ? 'INSUFFICIENT'
        : 'SUFFICIENT',
      lines: aggregatedLines,
    };
  }

  private async resolveLine(
    item: QuoteStockSnapshotItem,
  ): Promise<QuoteStockLine> {
    const areaM2 = Number(item.areaM2);
    const requiredQuantity = areaM2 * item.sheetsCount;

    if (!item.colorCode && item.colorName) {
      return {
        quoteItemId: item.id,
        productId: null,
        sku: null,
        requiredQuantity,
        availableQuantity: 0,
        shortage: requiredQuantity,
        resolution: 'UNSAFE_COLOR_IDENTITY',
      };
    }

    if (
      item.panelSizeName ||
      item.panelTypeCode ||
      item.qualityClassCode ||
      item.application !== null
    ) {
      return {
        quoteItemId: item.id,
        productId: null,
        sku: null,
        requiredQuantity,
        availableQuantity: 0,
        shortage: requiredQuantity,
        resolution: 'UNREPRESENTABLE_SPEC',
      };
    }

    const candidates = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: ProductStatus.ACTIVE,
        supplier: { code: item.supplierCode },
        thickness: Number(
          new Prisma.Decimal(item.thicknessMm.toString()).toString(),
        ),
        sheetArea: { gte: areaM2 - 0.0001, lte: areaM2 + 0.0001 },
        ...(item.colorCode ? { decorCode: item.colorCode } : {}),
        ...(item.colorName ? { colorName: item.colorName } : {}),
      },
      select: {
        id: true,
        sku: true,
        unit: true,
        stockBalance: { select: { onHand: true, reserved: true } },
      },
    });

    if (candidates.length !== 1) {
      return {
        quoteItemId: item.id,
        productId: null,
        sku: null,
        requiredQuantity,
        availableQuantity: 0,
        shortage: requiredQuantity,
        resolution: candidates.length === 0 ? 'NO_MATCH' : 'AMBIGUOUS_MATCH',
      };
    }

    const product = candidates[0];
    if (product.unit.toLowerCase() !== 'm2') {
      return {
        quoteItemId: item.id,
        productId: product.id,
        sku: product.sku,
        requiredQuantity,
        availableQuantity: 0,
        shortage: requiredQuantity,
        resolution: 'UNSUPPORTED_UNIT',
      };
    }

    const availableQuantity = product.stockBalance
      ? Math.max(0, product.stockBalance.onHand - product.stockBalance.reserved)
      : 0;
    return {
      quoteItemId: item.id,
      productId: product.id,
      sku: product.sku,
      requiredQuantity,
      availableQuantity,
      shortage: Math.max(0, requiredQuantity - availableQuantity),
      resolution: 'RESOLVED',
    };
  }
}
