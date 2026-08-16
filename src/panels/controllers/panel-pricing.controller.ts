import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../../common/interceptors/purchase-price.interceptor';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../modules/prisma/prisma.service';

@ApiTags('panel-pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('panel-pricing')
export class PanelPricingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('thickness')
  @RequirePermissions('panel_catalog:read')
  @ApiOperation({ summary: 'List active thickness pricing' })
  findActive() {
    const now = new Date();

    return this.prisma.panelThicknessPricing.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { thicknessMm: 'asc' },
    });
  }
}
