import { CreateExpectedReceiptDto } from './dto/create-expected-receipt.dto';
import { FilterExpectedReceiptDto } from './dto/filter-expected-receipt.dto';
import { FilterStockBalanceDto } from './dto/filter-stock-balance.dto';
import { ReceiveExpectedReceiptDto } from './dto/receive-expected-receipt.dto';
import { InventoryService } from './inventory.service';
export declare class InventoryController {
    private readonly inventoryService;
    constructor(inventoryService: InventoryService);
    listBalances(filterDto: FilterStockBalanceDto): Promise<{
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
            onHand: number;
            reserved: number;
            available: number;
            updatedBy: string | null;
        } & {
            available: number;
        })[];
        total: number;
        page: number;
        limit: number;
    }>;
    getExpectedReceipts(filterDto: FilterExpectedReceiptDto): Promise<{
        items: ({
            supplier: {
                id: string;
                name: string;
                createdAt: Date;
                updatedAt: Date;
                code: string;
                contacts: import("@prisma/client/runtime/client").JsonValue | null;
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
        })[];
        total: number;
        page: number;
        limit: number;
    }>;
    createExpectedReceipt(dto: CreateExpectedReceiptDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        supplierId: string | null;
        status: import("@prisma/client").$Enums.ExpectedReceiptStatus;
        comment: string | null;
        expectedDate: Date;
    }>;
    processReceipt(id: string, dto: ReceiveExpectedReceiptDto): Promise<{
        supplier: {
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            code: string;
            contacts: import("@prisma/client/runtime/client").JsonValue | null;
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
}
