import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateSupplierOrderDatesDto } from './dto/update-supplier-order-dates.dto';
import { UpdateSupplierOrderStatusDto } from './dto/update-supplier-order-status.dto';
import { SUPPLIER_ORDER_PERMISSIONS } from './supplier-order.constants';
import { SupplierOrdersService } from './supplier-orders.service';

@ApiTags('supplier-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('supplier-orders')
export class SupplierOrdersController {
  constructor(private readonly supplierOrdersService: SupplierOrdersService) {}

  @Get(':id')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'Get supplier order by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.findOne(id, user);
  }

  @Patch(':id/status')
  @RequirePermissions(SUPPLIER_ORDER_PERMISSIONS.MANAGE)
  @ApiOperation({ summary: 'Update supplier order status' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierOrderStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.updateStatus(id, dto.status, user);
  }

  @Patch(':id/dates')
  @RequirePermissions(SUPPLIER_ORDER_PERMISSIONS.MANAGE)
  @ApiOperation({ summary: 'Update planned supplier order dates' })
  updateDates(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierOrderDatesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.updateDates(id, dto, user);
  }

  @Post(':id/confirm-ready')
  @HttpCode(200)
  @RequirePermissions(SUPPLIER_ORDER_PERMISSIONS.MANAGE)
  @ApiOperation({ summary: 'Confirm supplier goods are ready for shipment' })
  confirmReady(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.confirmReady(id, user);
  }

  @Post(':id/confirm-client-delivery')
  @HttpCode(200)
  @RequirePermissions(SUPPLIER_ORDER_PERMISSIONS.CONFIRM_CLIENT_DELIVERY)
  @ApiOperation({
    summary: 'Confirm goods were actually delivered to the client',
  })
  confirmClientDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.confirmClientDelivery(id, user);
  }
}
