export declare class CreateExpectedReceiptItemDto {
    productId: string;
    quantity: number;
}
export declare class CreateExpectedReceiptDto {
    supplierId?: string;
    expectedDate: Date;
    items: CreateExpectedReceiptItemDto[];
}
