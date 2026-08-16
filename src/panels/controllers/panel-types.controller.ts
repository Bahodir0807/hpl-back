import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../modules/prisma/prisma.service';

@ApiTags('panel-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('panel-types')
export class PanelTypesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('panel_catalog:read')
  @ApiOperation({ summary: 'List active panel types' })
  findAll() {
    return this.prisma.panelType.findMany({
      where: { isActive: true },
      orderBy: { displayNameRu: 'asc' },
    });
  }
}
