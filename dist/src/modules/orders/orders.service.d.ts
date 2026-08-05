import { Delivery, Payment, Prisma } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CreateOrderFromDealDto } from './dto/create-order-from-deal.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FilterOrderDto } from './dto/filter-order.dto';
declare const orderDetailsInclude: {
    deal: {
        include: {
            client: true;
            projectObject: true;
            owner: true;
        };
    };
    items: {
        include: {
            product: true;
            deliveryItems: true;
        };
    };
    payments: {
        orderBy: {
            createdAt: "desc";
        };
    };
    deliveries: {
        include: {
            items: true;
        };
        orderBy: {
            deliveryDate: "desc";
        };
    };
    reservations: true;
};
type OrderDetails = Prisma.OrderGetPayload<{
    include: typeof orderDetailsInclude;
}>;
type OrderListResult = {
    items: OrderDetails[];
    total: number;
    page: number;
    limit: number;
};
export declare class OrdersService {
    private readonly prisma;
    private readonly inventoryService;
    constructor(prisma: PrismaService, inventoryService: InventoryService);
    createFromDeal(dto: CreateOrderFromDealDto, currentUserId: string): Promise<OrderDetails>;
    addPayment(dto: CreatePaymentDto, currentUserId: string): Promise<Payment>;
    confirmPayment(paymentId: string, dto: ConfirmPaymentDto, currentUserId?: string): Promise<OrderDetails>;
    createDelivery(dto: CreateDeliveryDto): Promise<Delivery>;
    findAll(filterDto: FilterOrderDto): Promise<OrderListResult>;
    findOne(id: string): Promise<OrderDetails>;
    private calculatePaymentStatus;
    private updateReservationFulfillment;
    private updateOrderShipmentStatus;
    private generateOrderNumber;
    private ensureOrderExists;
}
export {};
