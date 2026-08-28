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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { CALCULATION_PERMISSIONS } from './calculation.constants';
import { CalculationRequestService } from './calculation-request.service';
import { CalculationService } from './calculations.service';
import { ConvertCalculationToQuoteDto } from '../quotes/dto/convert-calculation-to-quote.dto';
import { QUOTE_PERMISSIONS } from '../quotes/quote.constants';
import { QuotesService } from '../quotes/quotes.service';
import { CreateCalculationRequestDto } from './dto/create-calculation-request.dto';
import { CreateCalculationDto } from './dto/create-calculation.dto';
import { PreviewCalculationDto } from './dto/calculation-item.dto';
import { FilterCalculationRequestsDto } from './dto/filter-calculation-requests.dto';
import { FilterCalculationsDto } from './dto/filter-calculations.dto';
import { UpdateCalculationRequestDto } from './dto/update-calculation-request.dto';
import { UpdateCalculationDto } from './dto/update-calculation.dto';

@ApiTags('calculations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('calculations')
export class CalculationsController {
  constructor(
    private readonly calculationService: CalculationService,
    private readonly calculationRequestService: CalculationRequestService,
    private readonly quotesService: QuotesService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions(CALCULATION_PERMISSIONS.CREATE, QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({ summary: 'HEAD creates a legacy priced calculation session' })
  @ApiResponse({ status: 201, description: 'Calculation created' })
  create(
    @Body() dto: CreateCalculationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.create(dto, user);
  }

  @Post('requests')
  @HttpCode(201)
  @RequirePermissions(CALCULATION_PERMISSIONS.CREATE)
  @ApiOperation({
    summary: 'Create one client calculation request with nested calculations',
  })
  createRequest(
    @Body() dto: CreateCalculationRequestDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationRequestService.create(dto, user);
  }

  @Get('requests')
  @RequirePermissions(CALCULATION_PERMISSIONS.READ)
  @ApiOperation({ summary: 'List calculation requests' })
  findAllRequests(
    @Query() filter: FilterCalculationRequestsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationRequestService.findAll(filter, user);
  }

  @Get('requests/:id')
  @RequirePermissions(CALCULATION_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Get calculation request with nested calculations' })
  findOneRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationRequestService.findOne(id, user);
  }

  @Patch('requests/:id')
  @RequirePermissions(CALCULATION_PERMISSIONS.UPDATE)
  @ApiOperation({
    summary: 'Update a draft request or let HEAD prepare a new Quote version',
  })
  updateRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalculationRequestDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationRequestService.update(id, dto, user);
  }

  @Post('requests/:id/submit')
  @RequirePermissions(CALCULATION_PERMISSIONS.UPDATE)
  @ApiOperation({ summary: 'Submit a calculation request to HEAD' })
  submitRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationRequestService.submit(id, user);
  }

  @Post('requests/:id/convert-to-quote')
  @HttpCode(201)
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary: 'HEAD creates a panel quote from a submitted calculation request',
  })
  convertRequestToQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertCalculationToQuoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.createFromRequest(id, dto, user);
  }

  @Post('preview')
  @RequirePermissions(CALCULATION_PERMISSIONS.CREATE, QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary: 'Preview calculation for one line item without saving',
  })
  preview(
    @Body() dto: PreviewCalculationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.preview(dto, user);
  }

  @Get()
  @RequirePermissions(CALCULATION_PERMISSIONS.READ)
  @ApiOperation({ summary: 'List calculation sessions' })
  findAll(
    @Query() filter: FilterCalculationsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.findAll(filter, user);
  }

  @Get(':id')
  @RequirePermissions(CALCULATION_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Get calculation session' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions(CALCULATION_PERMISSIONS.UPDATE, QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({ summary: 'Update draft calculation' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalculationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.update(id, dto, user);
  }

  @Post(':id/finalize')
  @RequirePermissions(CALCULATION_PERMISSIONS.UPDATE, QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({ summary: 'Finalize calculation (draft → finalized)' })
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.finalize(id, user);
  }

  @Post(':id/convert-to-quote')
  @HttpCode(201)
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary:
      'HEAD creates a draft panel quote from a finalized calculation. Kept for API compatibility; same quotes:approve rule as request conversion.',
  })
  convertToQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertCalculationToQuoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.createFromCalculation(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions(CALCULATION_PERMISSIONS.DELETE, QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({ summary: 'Soft delete calculation' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calculationService.softDelete(id, user);
  }
}
