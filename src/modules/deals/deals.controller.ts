import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChangeStageDto } from './dto/change-stage.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { FilterDealDto } from './dto/filter-deal.dto';
import { SetDealItemsDto } from './dto/set-deal-items.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { DealsService } from './deals.service';

@ApiTags('Deals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  @RequirePermissions('deals:create')
  @ApiOperation({ summary: 'Create deal with initial items and first task' })
  @ApiResponse({ status: 201, description: 'Deal created' })
  create(@Body() dto: CreateDealDto, @CurrentUser() user: CurrentUserType) {
    return this.dealsService.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'List deals for kanban or table view' })
  @ApiQuery({ name: 'stage', required: false })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'ownerId', required: false })
  @ApiQuery({ name: 'projectObjectId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Deal list returned' })
  findAll(
    @Query() filterDto: FilterDealDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.findAll(filterDto, user.id, user.permissions);
  }

  @Get(':id')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'Get deal card with all details' })
  @ApiResponse({ status: 200, description: 'Deal card returned' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.dealsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('deals:update')
  @ApiOperation({ summary: 'Update deal fields' })
  @ApiResponse({ status: 200, description: 'Deal updated' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealDto) {
    return this.dealsService.update(id, dto);
  }

  @Post(':id/stage')
  @RequirePermissions('deals:update')
  @ApiOperation({ summary: 'Move deal to another pipeline stage' })
  @ApiResponse({ status: 201, description: 'Deal stage changed' })
  @ApiResponse({ status: 400, description: 'Stage requirements are not met' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  changeStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStageDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.changeStage(id, dto, user.id, user.permissions);
  }

  @Post(':id/items')
  @RequirePermissions('deals:update')
  @ApiOperation({ summary: 'Add or update deal items and recalculate totals' })
  @ApiResponse({ status: 201, description: 'Deal items updated' })
  @ApiResponse({ status: 404, description: 'Deal or product not found' })
  setItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDealItemsDto,
  ) {
    return this.dealsService.setItems(id, dto);
  }

  @Post(':id/offers')
  @RequirePermissions('deals:create_offer')
  @ApiOperation({ summary: 'Create new commercial offer version' })
  @ApiResponse({ status: 201, description: 'Commercial offer created' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  addOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOfferDto,
  ) {
    return this.dealsService.addOffer(id, dto);
  }

  @Patch(':id/offers/:offerId/approve')
  @RequirePermissions('deals:approve_offer')
  @ApiOperation({ summary: 'Approve commercial offer' })
  @ApiResponse({ status: 200, description: 'Commercial offer approved' })
  @ApiResponse({ status: 404, description: 'Deal offer not found' })
  approveOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.dealsService.approveOffer(id, offerId);
  }

  @Delete(':id')
  @RequirePermissions('deals:delete')
  @ApiOperation({ summary: 'Soft delete deal' })
  @ApiResponse({ status: 200, description: 'Deal soft deleted' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  softDelete(@Param('id', ParseUUIDPipe) id: string) {
    return this.dealsService.softDelete(id);
  }
}
