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
import { ENGINEERING_PERMISSIONS } from '../engineering.constants';
import {
  FacadeAddItemDto,
  FacadeCalculateDto,
  FacadeSaveDraftDto,
} from './dto/facade-calculation.dto';
import { FacadeCalculationService } from './facade-calculation.service';

@ApiTags('Engineering facade')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('engineering/leads/:id/facade')
export class FacadeCalculationController {
  constructor(
    private readonly facadeCalculationService: FacadeCalculationService,
  ) {}

  @Get()
  @RequirePermissions(ENGINEERING_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Load facade subsystem calculator for an engineering lead',
  })
  getWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCalculationService.getWorkspace(id, user);
  }

  @Post('calculate')
  @RequirePermissions(ENGINEERING_PERMISSIONS.UPDATE_TECHNICAL)
  @ApiOperation({
    summary: 'Calculate facade materials from cladding area and approved norms',
  })
  calculate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacadeCalculateDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCalculationService.calculate(id, dto, user);
  }

  @Patch()
  @RequirePermissions(ENGINEERING_PERMISSIONS.UPDATE_TECHNICAL)
  @ApiOperation({ summary: 'Save facade subsystem calculation draft' })
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacadeSaveDraftDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCalculationService.saveDraft(id, dto, user);
  }

  @Post('items')
  @RequirePermissions(ENGINEERING_PERMISSIONS.UPDATE_TECHNICAL)
  @ApiOperation({ summary: 'Add an extra catalog material to the calculation' })
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FacadeAddItemDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeCalculationService.addItem(id, dto, user);
  }
}
