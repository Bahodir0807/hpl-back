import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../modules/prisma/prisma.service';

@ApiTags('panel-sizes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('panel-sizes')
export class PanelSizesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('panel_catalog:read')
  @ApiOperation({
    summary: 'List active panel sizes',
    description:
      'Canonical fields: id, widthMm, heightMm, displayName. Active list is the confirmed 24 standard sizes.',
  })
  findAll() {
    return this.prisma.panelSize.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
