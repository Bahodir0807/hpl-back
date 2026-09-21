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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import type { CurrentUser as CurrentUserType } from '../../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UpsertLeadQualificationDto } from '../dto/upsert-lead-qualification.dto';
import { ENGINEERING_PERMISSIONS } from './engineering.constants';
import { AssignEngineerDto } from './dto/assign-engineer.dto';
import { FilterEngineeringLeadsDto } from './dto/filter-engineering-leads.dto';
import { ReturnEngineeringAssignmentDto } from './dto/return-engineering-assignment.dto';
import { LeadEngineeringService } from './lead-engineering.service';

@ApiTags('Engineering')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('engineering')
export class LeadEngineeringController {
  constructor(
    private readonly leadEngineeringService: LeadEngineeringService,
  ) {}

  @Get('engineers')
  @RequirePermissions(ENGINEERING_PERMISSIONS.ASSIGN)
  @ApiOperation({ summary: 'List active users with the ENGINEER role' })
  listEngineers() {
    return this.leadEngineeringService.listEngineers();
  }

  @Get('leads')
  @RequirePermissions(ENGINEERING_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'List engineering leads assigned to the current user',
  })
  listQueue(
    @Query() filter: FilterEngineeringLeadsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.listQueue(filter, user);
  }

  @Get('leads/:id')
  @RequirePermissions(ENGINEERING_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Engineering workspace for an assigned lead' })
  getWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.getWorkspace(id, user);
  }

  @Post('leads/:id/assign')
  @RequirePermissions(ENGINEERING_PERMISSIONS.ASSIGN)
  @ApiOperation({
    summary: 'Assign an engineer without changing Lead.ownerId',
  })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignEngineerDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.assign(id, dto, user);
  }

  @Post('leads/:id/return')
  @RequirePermissions(ENGINEERING_PERMISSIONS.RETURN)
  @ApiOperation({ summary: 'Return an assigned lead to the owning manager' })
  returnToManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnEngineeringAssignmentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.returnToManager(id, dto, user);
  }

  @Post('leads/:id/complete')
  @RequirePermissions(ENGINEERING_PERMISSIONS.COMPLETE)
  @ApiOperation({
    summary:
      'Complete primary engineering qualification without closing assignment access',
  })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.complete(id, user);
  }

  @Post('leads/:id/finish')
  @RequirePermissions(ENGINEERING_PERMISSIONS.COMPLETE)
  @ApiOperation({
    summary: 'Close engineering work and drop assignment access',
  })
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.finish(id, user);
  }

  @Patch('leads/:id/qualification')
  @RequirePermissions(ENGINEERING_PERMISSIONS.UPDATE_TECHNICAL)
  @ApiOperation({
    summary:
      'Update allowed technical qualification fields for an assigned lead',
  })
  updateQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertLeadQualificationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.leadEngineeringService.updateTechnicalQualification(
      id,
      dto,
      user,
    );
  }
}
