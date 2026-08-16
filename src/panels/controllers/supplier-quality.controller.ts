import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../modules/prisma/prisma.service';

@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('suppliers')
export class SupplierQualityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':code/quality-classes')
  @RequirePermissions('panel_catalog:read')
  @ApiOperation({ summary: 'List quality classes for supplier and panel type' })
  @ApiQuery({ name: 'panelType', required: true })
  findQualityClasses(
    @Param('code') supplierCode: string,
    @Query('panelType') panelTypeCode?: string,
  ) {
    if (!panelTypeCode) {
      throw new BadRequestException('panelType query required');
    }

    return this.prisma.supplierQualityMapping.findMany({
      where: {
        supplier: { code: supplierCode },
        panelType: { code: panelTypeCode },
      },
      include: { qualityClass: true },
      orderBy: { qualityClass: { code: 'asc' } },
    });
  }
}
