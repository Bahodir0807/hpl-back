import { ExpectedReceipt, Prisma, StockReservation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpectedReceiptDto } from './dto/create-expected-receipt.dto';
import { FilterExpectedReceiptDto } from './dto/filter-expected-receipt.dto';
import { FilterStockBalanceDto } from './dto/filter-stock-balance.dto';
import { ReceiveExpectedReceiptDto } from './dto/receive-expected-receipt.dto';
export type StockBalanceSnapshot = {
    productId: string;
    onHand: number;
    reserved: number;
    available: number;
};
export type ReserveStockItem = {
    productId: string;
    quantity: number;
};
type StockBalanceListItem = Prisma.StockBalanceGetPayload<{
    include: {
        product: true;
    };
}> & {
    available: number;
};
type StockBalanceListResult = {
    items: StockBalanceListItem[];
    total: number;
    page: number;
    limit: number;
};
type ExpectedReceiptListItem = Prisma.ExpectedReceiptGetPayload<{
    include: {
        supplier: true;
        items: {
            include: {
                product: true;
            };
        };
    };
}>;
type ExpectedReceiptListResult = {
    items: ExpectedReceiptListItem[];
    total: number;
    page: number;
    limit: number;
};
export declare class InventoryService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    listBalances(filterDto: FilterStockBalanceDto): Promise<StockBalanceListResult>;
    getBalance(productId: string): Promise<StockBalanceSnapshot>;
    getExpectedReceipts(filterDto: FilterExpectedReceiptDto): Promise<ExpectedReceiptListResult>;
    reserveStock(orderId: string, items: ReserveStockItem[], tx?: Prisma.TransactionClient): Promise<StockReservation[]>;
    releaseReservation(orderId: string, tx?: Prisma.TransactionClient): Promise<void>;
    createExpectedReceipt(dto: CreateExpectedReceiptDto): Promise<ExpectedReceipt>;
    processReceipt(id: string, dto: ReceiveExpectedReceiptDto): Promise<{
        supplier: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            code: string;
            contacts: Prisma.JsonValue | null;
        } | null;
        items: ({
            product: {
                length: number;
                id: string;
                name: string;
                createdAt: Date;
                updatedAt: Date;
                brandId: string;
                sku: string;
                collectionId: string | null;
                supplierId: string | null;
                decorCode: string | null;
                colorName: string | null;
                surface: string | null;
                thickness: number;
                width: number;
                unit: string;
                sheetArea: number;
                status: import("@prisma/client").$Enums.ProductStatus;
                deletedAt: Date | null;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            productId: string;
            quantity: number;
            receivedQuantity: number;
            expectedReceiptId: string;
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        supplierId: string | null;
        status: import("@prisma/client").$Enums.ExpectedReceiptStatus;
        comment: string | null;
        expectedDate: Date;
    }>;
    private assertReservationAvailable;
    private aggregateItems;
    private calculateAvailable;
    private calculateReceiptStatus;
}
export {};
