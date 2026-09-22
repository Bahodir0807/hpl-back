import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  CreateInstallationContractorDto,
  CreateInstallationRateDto,
  CreateInstallationWorkTypeDto,
  UpdateInstallationContractorDto,
  UpdateInstallationRateDto,
  UpdateInstallationWorkTypeDto,
} from './dto/installation-catalog.dto';
import { InstallationCatalogService } from './installation-catalog.service';

@ApiTags('Installation catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('references')
export class InstallationCatalogController {
  constructor(
    private readonly installationCatalogService: InstallationCatalogService,
  ) {}

  @Get('installation-work-types')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS)
  @ApiOperation({ summary: 'List installation work types' })
  listWorkTypes(
    @CurrentUser() user: CurrentUserType,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.installationCatalogService.listWorkTypes(
      user,
      includeInactive === 'true',
    );
  }

  @Post('installation-work-types')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS)
  @ApiOperation({ summary: 'Create an installation work type' })
  createWorkType(
    @Body() dto: CreateInstallationWorkTypeDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCatalogService.createWorkType(dto, user);
  }

  @Patch('installation-work-types/:id')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS)
  @ApiOperation({ summary: 'Update or deactivate an installation work type' })
  updateWorkType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstallationWorkTypeDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCatalogService.updateWorkType(id, dto, user);
  }

  @Get('installation-contractors')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS)
  @ApiOperation({ summary: 'List installation crews and contractors' })
  listContractors(
    @CurrentUser() user: CurrentUserType,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.installationCatalogService.listContractors(
      user,
      includeInactive === 'true',
    );
  }

  @Post('installation-contractors')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS)
  @ApiOperation({ summary: 'Create an installation crew or contractor' })
  createContractor(
    @Body() dto: CreateInstallationContractorDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCatalogService.createContractor(dto, user);
  }

  @Patch('installation-contractors/:id')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS)
  @ApiOperation({ summary: 'Update or deactivate an installation contractor' })
  updateContractor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstallationContractorDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCatalogService.updateContractor(id, dto, user);
  }

  @Get('installation-rates')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.READ_COST)
  @ApiOperation({ summary: 'List installation contractor rates' })
  listRates(
    @CurrentUser() user: CurrentUserType,
    @Query('contractorId') contractorId?: string,
    @Query('workTypeId') workTypeId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.installationCatalogService.listRates(user, {
      contractorId,
      workTypeId,
      includeInactive: includeInactive === 'true',
    });
  }

  @Post('installation-rates')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_RATES)
  @ApiOperation({ summary: 'Create an installation contractor rate' })
  createRate(
    @Body() dto: CreateInstallationRateDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCatalogService.createRate(dto, user);
  }

  @Patch('installation-rates/:id')
  @RequirePermissions(INSTALLATION_PRICING_PERMISSIONS.MANAGE_RATES)
  @ApiOperation({ summary: 'Update or deactivate an installation rate' })
  updateRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstallationRateDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.installationCatalogService.updateRate(id, dto, user);
  }
}
