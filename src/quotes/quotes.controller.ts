import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../common/interceptors/purchase-price.interceptor';
import type { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { FilterQuotesDto } from './dto/filter-quotes.dto';
import { QuoteCompositionQueryDto } from './dto/quote-composition-query.dto';
import { CreateQuoteVersionDto } from './dto/create-quote-version.dto';
import {
  FinalizeQuoteDto,
  PreviewQuotePricingDto,
  UpdateQuoteApprovedPricingDto,
} from './dto/update-quote-approved-pricing.dto';
import { UpdateQuoteCommercialTermsDto } from './dto/update-quote-commercial-terms.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { MarkCustomerAcceptedDto } from './dto/mark-customer-accepted.dto';
import { QUOTE_PERMISSIONS } from './quote.constants';
import { QuotesService } from './quotes.service';
import { QuoteDocumentService } from './quote-document.service';
import type { Response } from 'express';

@ApiTags('quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly quoteDocumentService: QuoteDocumentService,
  ) {}

  @Get()
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({ summary: 'List panel quotes' })
  findAll(
    @Query() filter: FilterQuotesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.findAll(filter, user);
  }

  @Get('composition')
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Preview approved HPL / facade / installation quote composition',
  })
  composition(
    @Query() query: QuoteCompositionQueryDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.getComposition(query.leadId, user);
  }

  @Get(':id')
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({ summary: 'Get panel quote by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.findOne(id, user);
  }

  @Get(':id/stock-availability')
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Check usable inventory for a stock-only Quote snapshot',
  })
  getStockAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.getStockAvailability(id, user);
  }

  @Get(':id/pdf')
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({
    summary:
      'Download a Quote PDF rendered from the filled UZHPL DOCX template',
  })
  async getPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Res() response: Response,
  ): Promise<void> {
    const quote = await this.quotesService.findOne(id, user);
    this.quotesService.assertCanDownloadCustomerDocument(quote, user);
    const document = await this.quoteDocumentService.generate(id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.filename}"`,
    );
    response.send(document.buffer);
  }

  @Get(':id/docx')
  @RequirePermissions(QUOTE_PERMISSIONS.READ)
  @ApiOperation({
    summary: 'Download a Quote DOCX filled from the UZHPL golden template',
  })
  async getDocx(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
    @Res() response: Response,
  ): Promise<void> {
    const quote = await this.quotesService.findOne(id, user);
    this.quotesService.assertCanDownloadCustomerDocument(quote, user);
    const document = await this.quoteDocumentService.generateDocx(id);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.filename}"`,
    );
    response.send(document.buffer);
  }

  @Patch(':id/status')
  @RequirePermissions(QUOTE_PERMISSIONS.UPDATE)
  @ApiOperation({
    summary: 'Update quote status (FSM). Approval requires quotes:approve',
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.updateStatus(id, dto, user);
  }

  @Patch(':id/commercial-terms')
  @RequirePermissions(QUOTE_PERMISSIONS.UPDATE)
  @ApiOperation({
    summary: 'Update HEAD-owned client-facing Quote terms.',
  })
  updateCommercialTerms(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteCommercialTermsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.updateCommercialTerms(id, dto, user);
  }

  @Patch(':id/approved-pricing')
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary:
      'HEAD approves server-calculated USD pricing from purchase CNY/m2 per item',
  })
  updateApprovedPricing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteApprovedPricingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.updateApprovedPricing(id, dto, user);
  }

  @Post(':id/pricing-preview')
  @HttpCode(200)
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary: 'Calculate Quote prices from HEAD purchase prices in CNY/m2',
  })
  previewPricing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewQuotePricingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.previewPricing(id, dto, user);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary: 'Finalize the Quote snapshot and persist the customer PDF',
  })
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinalizeQuoteDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.finalize(id, dto, user);
  }

  @Post(':id/versions')
  @HttpCode(201)
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({ summary: 'Create the next immutable Quote version' })
  createNextVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuoteVersionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.createNextVersion(id, user, dto);
  }

  @Post(':id/client-accept')
  @HttpCode(200)
  @RequirePermissions(QUOTE_PERMISSIONS.MARK_CUSTOMER_ACCEPTED)
  @ApiOperation({
    summary:
      'Record that the customer accepted this exact finalized Quote version',
  })
  recordClientAcceptance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkCustomerAcceptedDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.recordClientAcceptance(id, user, dto?.note);
  }

  @Post(':id/convert-to-deal')
  @HttpCode(201)
  @RequirePermissions(QUOTE_PERMISSIONS.APPROVE)
  @ApiOperation({ summary: 'HEAD converts a finalized approved quote to deal' })
  convertToDeal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotesService.convertToDeal(id, user);
  }
}
