import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InstallationStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { DealInstallationService } from './deal-installation.service';
import { INSTALLATION_ASSESS_PERMISSION } from './deal-fulfillment.constants';
import { FilterInstallationDto } from './dto/filter-installation.dto';

@ApiTags('Installations')
@ApiBearerAuth()
@Controller('installations')
export class InstallationsController {
  constructor(
    private readonly dealInstallationService: DealInstallationService,
  ) {}

  @Get()
  @RequirePermissions(INSTALLATION_ASSESS_PERMISSION)
  @ApiOperation({
    summary:
      'List installation jobs for INSTALLER, HEAD, and DIRECTOR without Deal sales visibility',
  })
  @ApiQuery({ name: 'status', required: false, enum: InstallationStatus })
  @ApiQuery({ name: 'requiringAction', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Installation job list returned' })
  list(
    @Query() filterDto: FilterInstallationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.list(filterDto, user);
  }

  @Get(':id')
  @RequirePermissions(INSTALLATION_ASSESS_PERMISSION)
  @ApiOperation({
    summary:
      'Get one installation job by id, including dealId for notification resolution',
  })
  @ApiResponse({ status: 200, description: 'Installation job returned' })
  @ApiResponse({ status: 404, description: 'Installation job not found' })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.getById(id, user);
  }
}
