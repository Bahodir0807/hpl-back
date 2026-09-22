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
import { FACADE_PRICING_PERMISSIONS } from './facade-pricing.constants';
import {
  CreateFacadeMaterialOfferDto,
  UpdateFacadeMaterialOfferDto,
} from './dto/facade-offer.dto';
import { FacadeMaterialOfferService } from './facade-material-offer.service';

@ApiTags('Facade supplier offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('references/facade-offers')
export class FacadeMaterialOfferController {
  constructor(private readonly facadeMaterialOfferService: FacadeMaterialOfferService) {}

  @Get()
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.READ_PURCHASE)
  @ApiOperation({ summary: 'List facade material supplier offers' })
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('materialId') materialId?: string,
  ) {
    return this.facadeMaterialOfferService.list(user, materialId);
  }

  @Post()
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.MANAGE_OFFERS)
  @ApiOperation({ summary: 'Create a facade material supplier offer' })
  create(
    @Body() dto: CreateFacadeMaterialOfferDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeMaterialOfferService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions(FACADE_PRICING_PERMISSIONS.MANAGE_OFFERS)
  @ApiOperation({ summary: 'Update or deactivate a facade material supplier offer' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFacadeMaterialOfferDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.facadeMaterialOfferService.update(id, dto, user);
  }
}
