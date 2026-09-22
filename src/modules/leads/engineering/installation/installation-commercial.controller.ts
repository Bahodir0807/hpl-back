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
import { INSTALLATION_PRICING_PERMISSIONS } from './installation-pricing.constants';
import {
  ApproveInstallationCommercialDto,
  PatchInstallationCommercialDto,
  RepriceInstallationCommercialDto,
  SubmitInstallationCommercialDto,
} from './dto/installation-commercial.dto';
import { InstallationCommercialService } from './installation-commercial.service';

@ApiTags('Installation commercial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads/:id/installation-commercial')
export class InstallationCommercialController {
  constructor(
    private readonly installationCommercialService: InstallationCommercialService,
  ) {}

  @Get()
  @RequirePermissions('leads:read')
  @ApiOperation({ summary: 'Load installation commercial calculation' })
  getCurrent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCommercialService.getCurrent(id, user);
  }

  @Post()
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Create a commercial calculation from the technical snapshot',
  })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCommercialService.createFromTechnical(id, user);
  }

  @Patch()
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Select contractor rates and set customer commercial amount',
  })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchInstallationCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCommercialService.patch(id, dto, user);
  }

  @Post('submit')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Submit installation commercial calculation for approval',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitInstallationCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCommercialService.submit(id, dto, user);
  }

  @Post('approve')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary: 'Approve installation customer amount (HEAD or DIRECTOR)',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveInstallationCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCommercialService.approve(id, dto, user);
  }

  @Post('revisions')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Create a new commercial revision from the latest technical takeoff',
  })
  reprice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepriceInstallationCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCommercialService.reprice(id, dto, user);
  }
}
