export declare class CreateDeliveryItemDto {
    orderItemId: string;
    quantity: number;
}
export declare class CreateDeliveryDto {
    orderId: string;
    deliveryDate: Date;
    recipient?: string;
    trackingNumber?: string;
    items: CreateDeliveryItemDto[];
}
