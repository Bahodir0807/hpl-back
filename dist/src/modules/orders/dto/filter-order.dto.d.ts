import { OrderStatus, PaymentStatus } from '@prisma/client';
export declare class FilterOrderDto {
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    dealId?: string;
    page?: number;
    limit?: number;
}
