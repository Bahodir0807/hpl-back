import { ExpectedReceiptStatus } from '@prisma/client';
export declare class FilterExpectedReceiptDto {
    supplierId?: string;
    status?: ExpectedReceiptStatus;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
}
