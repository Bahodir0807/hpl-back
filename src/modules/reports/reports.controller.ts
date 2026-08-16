import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('funnel')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Get aggregated sales funnel report' })
  @ApiResponse({ status: 200, description: 'Funnel report returned' })
  getFunnel(
    @Query() filterDto: ReportFilterDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(user);
    return this.reportsService.getFunnel(filterDto);
  }

  @Get('overdues')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Get overdue task report grouped by managers' })
  @ApiResponse({ status: 200, description: 'Overdue report returned' })
  getOverdues(
    @Query() filterDto: ReportFilterDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(user);
    return this.reportsService.getOverdues(filterDto);
  }

  @Get('kpi')
  @RequirePermissions('reports:read')
  @ApiOperation({ summary: 'Get manager KPI report' })
  @ApiResponse({ status: 200, description: 'KPI report returned' })
  getKpi(
    @Query() filterDto: ReportFilterDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    this.usersService.assertUserModuleAccess(user);
    return this.reportsService.getKpi(filterDto);
  }
}
