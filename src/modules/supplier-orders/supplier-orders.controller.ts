import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateSupplierOrderStatusDto } from './dto/update-supplier-order-status.dto';
import { SupplierOrdersService } from './supplier-orders.service';

@ApiTags('supplier-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('supplier-orders')
export class SupplierOrdersController {
  constructor(
    private readonly supplierOrdersService: SupplierOrdersService,
  ) {}

  @Patch(':id/status')
  @RequirePermissions('deals:update')
  @ApiOperation({ summary: 'Update supplier order status' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierOrderStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.updateStatus(id, dto.status, user);
  }

  @Get(':dealId')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'Get supplier order by deal id' })
  findByDealId(
    @Param('dealId', ParseUUIDPipe) dealId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.findByDealId(dealId, user);
  }
}
