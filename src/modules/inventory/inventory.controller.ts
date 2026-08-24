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
import { CreateExpectedReceiptDto } from './dto/create-expected-receipt.dto';
import { FilterExpectedReceiptDto } from './dto/filter-expected-receipt.dto';
import { FilterStockBalanceDto } from './dto/filter-stock-balance.dto';
import { ReceiveExpectedReceiptDto } from './dto/receive-expected-receipt.dto';
import { UpdateWarehousePurchaseDto } from './dto/update-warehouse-purchase.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('balances')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'List stock balances and reservations' })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Stock balance list returned' })
  listBalances(@Query() filterDto: FilterStockBalanceDto) {
    return this.inventoryService.listBalances(filterDto);
  }

  @Get('expected-receipts')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'List expected supplier receipts' })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Expected receipt list returned' })
  getExpectedReceipts(@Query() filterDto: FilterExpectedReceiptDto) {
    return this.inventoryService.getExpectedReceipts(filterDto);
  }

  @Get('warehouse-purchases')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'List warehouse purchases' })
  getWarehousePurchases(@Query() filterDto: FilterExpectedReceiptDto) {
    return this.inventoryService.getExpectedReceipts(filterDto);
  }

  @Post('expected-receipts')
  @RequirePermissions('warehouse_purchases:plan')
  @ApiOperation({ summary: 'Plan expected supplier receipt' })
  @ApiResponse({ status: 201, description: 'Expected receipt created' })
  createExpectedReceipt(
    @Body() dto: CreateExpectedReceiptDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.inventoryService.createExpectedReceipt(dto, user.id);
  }

  @Post('warehouse-purchases')
  @RequirePermissions('warehouse_purchases:plan')
  @ApiOperation({ summary: 'Create warehouse purchase plan' })
  @ApiResponse({ status: 201, description: 'Warehouse purchase created' })
  createWarehousePurchase(
    @Body() dto: CreateExpectedReceiptDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.inventoryService.createExpectedReceipt(dto, user.id);
  }

  @Patch('warehouse-purchases/:id')
  @RequirePermissions('warehouse_purchases:plan')
  @ApiOperation({ summary: 'Update warehouse purchase plan' })
  updateWarehousePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehousePurchaseDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.inventoryService.updateWarehousePurchase(id, dto, user.id);
  }

  @Post('warehouse-purchases/:id/cancel')
  @RequirePermissions('warehouse_purchases:plan')
  @ApiOperation({ summary: 'Cancel warehouse purchase before receipt' })
  cancelWarehousePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.inventoryService.cancelWarehousePurchase(id, user.id);
  }

  @Post('expected-receipts/:id/receive')
  @RequirePermissions('warehouse_purchases:receive')
  @ApiOperation({ summary: 'Receive expected goods to stock' })
  @ApiResponse({ status: 201, description: 'Expected receipt processed' })
  @ApiResponse({
    status: 400,
    description: 'Received quantity exceeds expected quantity',
  })
  @ApiResponse({ status: 404, description: 'Expected receipt not found' })
  processReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveExpectedReceiptDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.inventoryService.processReceipt(id, dto, user.id);
  }

  @Post('warehouse-purchases/:id/receipts')
  @RequirePermissions('warehouse_purchases:receive')
  @ApiOperation({ summary: 'Receive warehouse purchase goods to stock' })
  @ApiResponse({ status: 201, description: 'Warehouse receipt recorded' })
  receiveWarehousePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveExpectedReceiptDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.inventoryService.processReceipt(id, dto, user.id);
  }
}
