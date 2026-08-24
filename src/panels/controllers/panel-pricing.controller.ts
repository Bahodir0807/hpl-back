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
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { CreateThicknessPricingDto } from '../dto/create-thickness-pricing.dto';
import { UpdateThicknessPricingDto } from '../dto/update-thickness-pricing.dto';
import { PANEL_PRICING_MANAGE_PERMISSION } from '../pricing/hpl-pricing.constants';
import { PanelThicknessPricingService } from '../services/panel-thickness-pricing.service';

@ApiTags('panel-pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('panel-pricing')
export class PanelPricingController {
  constructor(
    private readonly panelThicknessPricingService: PanelThicknessPricingService,
  ) {}

  @Get('thickness')
  @RequirePermissions('panel_catalog:read')
  @ApiOperation({ summary: 'List active thickness pricing' })
  findActive() {
    return this.panelThicknessPricingService.listActive();
  }

  @Post('thickness')
  @HttpCode(201)
  @RequirePermissions(PANEL_PRICING_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Create a supplier CNY thickness price (HEAD)' })
  create(
    @Body() dto: CreateThicknessPricingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.panelThicknessPricingService.create({
      supplierId: dto.supplierId,
      qualityClassId: dto.qualityClassId,
      panelTypeId: dto.panelTypeId,
      thicknessMm: dto.thicknessMm,
      basePricePerM2: dto.basePricePerM2,
      createdById: user.id,
    });
  }

  @Patch('thickness/:id')
  @RequirePermissions(PANEL_PRICING_MANAGE_PERMISSION)
  @ApiOperation({ summary: 'Update a supplier CNY thickness price (HEAD)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateThicknessPricingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.panelThicknessPricingService.update(id, {
      basePricePerM2: dto.basePricePerM2,
      isActive: dto.isActive,
      updatedById: user.id,
    });
  }
}
