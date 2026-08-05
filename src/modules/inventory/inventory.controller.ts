import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateExpectedReceiptDto } from './dto/create-expected-receipt.dto';
import { FilterExpectedReceiptDto } from './dto/filter-expected-receipt.dto';
import { FilterStockBalanceDto } from './dto/filter-stock-balance.dto';
import { ReceiveExpectedReceiptDto } from './dto/receive-expected-receipt.dto';
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

  @Post('expected-receipts')
  @RequirePermissions('inventory:manage')
  @ApiOperation({ summary: 'Plan expected supplier receipt' })
  @ApiResponse({ status: 201, description: 'Expected receipt created' })
  createExpectedReceipt(@Body() dto: CreateExpectedReceiptDto) {
    return this.inventoryService.createExpectedReceipt(dto);
  }

  @Post('expected-receipts/:id/receive')
  @RequirePermissions('inventory:manage')
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
  ) {
    return this.inventoryService.processReceipt(id, dto);
  }
}
