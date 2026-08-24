import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CreateSupplierOrderDto } from '../supplier-orders/dto/create-supplier-order.dto';
import { SUPPLIER_ORDER_PERMISSIONS } from '../supplier-orders/supplier-order.constants';
import { SupplierOrdersService } from '../supplier-orders/supplier-orders.service';
import { DealInstallationService } from './deal-installation.service';
import {
  INSTALLATION_ASSESS_PERMISSION,
  INSTALLATION_CONFIRM_SUPERVISOR_PERMISSION,
  INSTALLATION_CONFIRM_WORK_PERMISSION,
  INSTALLATION_SCHEDULE_PERMISSION,
} from './deal-fulfillment.constants';
import { ScheduleInstallationDto } from './dto/schedule-installation.dto';
import { UpdateInstallationAssessmentDto } from './dto/update-installation-assessment.dto';

@ApiTags('Deals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('deals')
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly supplierOrdersService: SupplierOrdersService,
    private readonly dealInstallationService: DealInstallationService,
  ) {}

  @Post()
  @RequirePermissions('deals:create')
  @ApiOperation({ summary: 'Create deal with initial items and first task' })
  @ApiResponse({ status: 201, description: 'Deal created' })
  create(@Body() dto: CreateDealDto, @CurrentUser() user: CurrentUserType) {
    return this.dealsService.create(dto, user);
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
    return this.dealsService.findAll(filterDto, user);
  }

  @Get(':id/delivery-status')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'Get deal delivery status from supplier order' })
  @ApiResponse({ status: 200, description: 'Delivery status returned' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  getDeliveryStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.getDeliveryStatus(id, user);
  }

  @Get(':id/supplier-orders')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'List supplier orders for a deal' })
  @ApiResponse({ status: 200, description: 'Supplier orders returned' })
  listSupplierOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.findByDealId(id, user);
  }

  @Post(':id/supplier-orders')
  @RequirePermissions(SUPPLIER_ORDER_PERMISSIONS.MANAGE)
  @ApiOperation({ summary: 'Create a supplier order for a client Deal' })
  @ApiResponse({ status: 201, description: 'Supplier order created' })
  createSupplierOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupplierOrderDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.supplierOrdersService.createForDeal(id, dto, user);
  }

  @Get(':id/installation')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'Get the deal installation job if it exists' })
  getInstallation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.getByDealId(id, user);
  }

  @Post(':id/installation/schedule')
  @HttpCode(200)
  @RequirePermissions(INSTALLATION_SCHEDULE_PERMISSION)
  @ApiOperation({ summary: 'Schedule or update installation planned dates' })
  scheduleInstallation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleInstallationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.schedule(id, dto, user);
  }

  @Patch(':id/installation/assessment')
  @RequirePermissions(INSTALLATION_ASSESS_PERMISSION)
  @ApiOperation({ summary: 'Update lightweight installation assessment notes' })
  updateInstallationAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstallationAssessmentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.updateAssessment(id, dto, user);
  }

  @Post(':id/installation/start')
  @HttpCode(200)
  @RequirePermissions(INSTALLATION_CONFIRM_WORK_PERMISSION)
  @ApiOperation({ summary: 'Mark installation work as started' })
  startInstallation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.start(id, user);
  }

  @Post(':id/installation/confirm-installer')
  @HttpCode(200)
  @RequirePermissions(INSTALLATION_CONFIRM_WORK_PERMISSION)
  @ApiOperation({
    summary: 'Installer confirmation of completed installation work',
  })
  confirmInstaller(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.confirmInstaller(id, user);
  }

  @Post(':id/installation/confirm-supervisor')
  @HttpCode(200)
  @RequirePermissions(INSTALLATION_CONFIRM_SUPERVISOR_PERMISSION)
  @ApiOperation({
    summary: 'HEAD or DIRECTOR confirmation of installation completion',
  })
  confirmSupervisor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealInstallationService.confirmSupervisor(id, user);
  }

  @Get(':id')
  @RequirePermissions('deals:read')
  @ApiOperation({ summary: 'Get deal card with all details' })
  @ApiResponse({ status: 200, description: 'Deal card returned' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('deals:update')
  @ApiOperation({ summary: 'Update deal fields' })
  @ApiResponse({ status: 200, description: 'Deal updated' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDealDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.update(id, dto, user);
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
    return this.dealsService.changeStage(id, dto, user);
  }

  @Post(':id/items')
  @RequirePermissions('deals:update')
  @ApiOperation({ summary: 'Add or update deal items and recalculate totals' })
  @ApiResponse({ status: 201, description: 'Deal items updated' })
  @ApiResponse({ status: 404, description: 'Deal or product not found' })
  setItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDealItemsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.setItems(id, dto, user);
  }

  @Post(':id/offers')
  @RequirePermissions('deals:create_offer')
  @ApiOperation({ summary: 'Create new commercial offer version' })
  @ApiResponse({ status: 201, description: 'Commercial offer created' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  addOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOfferDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.addOffer(id, dto, user);
  }

  @Patch(':id/offers/:offerId/approve')
  @RequirePermissions('deals:approve_offer')
  @ApiOperation({ summary: 'Approve commercial offer' })
  @ApiResponse({ status: 200, description: 'Commercial offer approved' })
  @ApiResponse({ status: 404, description: 'Deal offer not found' })
  approveOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.approveOffer(id, offerId, user);
  }

  @Delete(':id')
  @RequirePermissions('deals:delete')
  @ApiOperation({ summary: 'Soft delete deal' })
  @ApiResponse({ status: 200, description: 'Deal soft deleted' })
  @ApiResponse({ status: 404, description: 'Deal not found' })
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.dealsService.softDelete(id, user);
  }
}
