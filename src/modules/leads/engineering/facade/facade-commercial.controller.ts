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
import { FACADE_PRICING_PERMISSIONS } from './facade-pricing.constants';
import {
  ApproveFacadeCommercialDto,
  PatchFacadeCommercialDto,
  RepriceFacadeCommercialDto,
  SubmitFacadeCommercialDto,
} from './dto/facade-commercial.dto';
import { FacadeCommercialService } from './facade-commercial.service';

@ApiTags('Facade commercial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads/:id/facade-commercial')
export class FacadeCommercialController {
  constructor(
    private readonly facadeCommercialService: FacadeCommercialService,
  ) {}

  @Get()
  @RequirePermissions('leads:read')
  @ApiOperation({ summary: 'Load facade subsystem commercial calculation' })
  getCurrent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCommercialService.getCurrent(id, user);
  }

  @Post()
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Create a commercial calculation from the technical snapshot',
  })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCommercialService.createFromTechnical(id, user);
  }

  @Patch()
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Select supplier offers and set customer commercial amount',
  })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchFacadeCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCommercialService.patch(id, dto, user);
  }

  @Post('submit')
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({ summary: 'Submit facade commercial calculation for approval' })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitFacadeCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCommercialService.submit(id, dto, user);
  }

  @Post('approve')
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary: 'Approve facade subsystem customer amount (HEAD or DIRECTOR)',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveFacadeCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCommercialService.approve(id, dto, user);
  }

  @Post('revisions')
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.PREPARE)
  @ApiOperation({
    summary: 'Create a new commercial revision from the latest technical takeoff',
  })
  reprice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepriceFacadeCommercialDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCommercialService.reprice(id, dto, user);
  }
}
