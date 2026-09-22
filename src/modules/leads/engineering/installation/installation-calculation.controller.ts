import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { INSTALLATION_PERMISSIONS } from './installation-pricing.constants';
import {
  InstallationCompleteDto,
  InstallationSaveDraftDto,
} from './dto/installation-calculation.dto';
import { InstallationCalculationService } from './installation-calculation.service';

@ApiTags('Engineering installation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('engineering/leads/:id/installation')
export class InstallationCalculationController {
  constructor(
    private readonly installationCalculationService: InstallationCalculationService,
  ) {}

  @Get()
  @RequirePermissions(INSTALLATION_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Load installation calculator for an engineering lead',
  })
  getWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCalculationService.getWorkspace(id, user);
  }

  @Patch()
  @RequirePermissions(INSTALLATION_PERMISSIONS.UPDATE_TECHNICAL)
  @ApiOperation({ summary: 'Save installation calculation draft' })
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InstallationSaveDraftDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCalculationService.saveDraft(id, dto, user);
  }

  @Post('complete')
  @RequirePermissions(INSTALLATION_PERMISSIONS.UPDATE_TECHNICAL)
  @ApiOperation({ summary: 'Mark installation technical calculation as ready' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InstallationCompleteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCalculationService.complete(id, dto, user);
  }
}
