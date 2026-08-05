import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CreateOrderFromDealDto } from './dto/create-order-from-deal.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FilterOrderDto } from './dto/filter-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('from-deal')
  @RequirePermissions('orders:create')
  @ApiOperation({ summary: 'Create order from won deal' })
  @ApiResponse({ status: 201, description: 'Order created' })
  @ApiResponse({ status: 400, description: 'Deal is not won or has no items' })
  @ApiResponse({ status: 409, description: 'Order already exists for deal' })
  createFromDeal(
    @Body() dto: CreateOrderFromDealDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.ordersService.createFromDeal(dto, user.id);
  }

  @Get()
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'List orders with status and payment filters' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'paymentStatus', required: false })
  @ApiQuery({ name: 'dealId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Order list returned' })
  findAll(@Query() filterDto: FilterOrderDto) {
    return this.ordersService.findAll(filterDto);
  }

  @Get(':id')
  @RequirePermissions('orders:read')
  @ApiOperation({
    summary: 'Get order card with items, payments and deliveries',
  })
  @ApiResponse({ status: 200, description: 'Order card returned' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @Post(':id/payments')
  @RequirePermissions('payments:create')
  @ApiOperation({ summary: 'Register pending payment for order' })
  @ApiResponse({ status: 201, description: 'Payment registered' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.ordersService.addPayment({ ...dto, orderId: id }, user.id);
  }

  @Patch('payments/:paymentId/confirm')
  @RequirePermissions('payments:confirm')
  @ApiOperation({
    summary: 'Confirm or reject payment and recalculate balance',
  })
  @ApiResponse({ status: 200, description: 'Payment status applied' })
  @ApiResponse({ status: 400, description: 'Invalid payment status' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  confirmPayment(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ConfirmPaymentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.ordersService.confirmPayment(paymentId, dto, user.id);
  }

  @Post(':id/deliveries')
  @RequirePermissions('deliveries:create')
  @ApiOperation({ summary: 'Create and execute order delivery' })
  @ApiResponse({
    status: 201,
    description: 'Delivery created and stock written off',
  })
  @ApiResponse({
    status: 400,
    description: 'Insufficient stock or invalid quantity',
  })
  @ApiResponse({ status: 404, description: 'Order or order item not found' })
  createDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDeliveryDto,
  ) {
    return this.ordersService.createDelivery({ ...dto, orderId: id });
  }
}
