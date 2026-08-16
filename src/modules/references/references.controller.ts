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
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PurchasePriceInterceptor } from '../../common/interceptors/purchase-price.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateBrandDto } from './dto/create-brand.dto';
import { CreateProductCollectionDto } from './dto/create-product-collection.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { UpdateProductCollectionDto } from './dto/update-product-collection.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ReferencesService } from './references.service';

@ApiTags('References')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(PurchasePriceInterceptor)
@Controller('references')
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Post('suppliers')
  @RequirePermissions('references:create')
  @ApiOperation({ summary: 'Create supplier' })
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.referencesService.createSupplier(dto);
  }

  @Get('suppliers')
  @RequirePermissions('references:read')
  @ApiOperation({ summary: 'List suppliers' })
  findSuppliers() {
    return this.referencesService.findSuppliers();
  }

  @Get('suppliers/:id')
  @RequirePermissions('references:read')
  @ApiOperation({ summary: 'Get supplier' })
  findSupplier(@Param('id', ParseUUIDPipe) id: string) {
    return this.referencesService.findSupplier(id);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('references:update')
  @ApiOperation({ summary: 'Update supplier' })
  updateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.referencesService.updateSupplier(id, dto);
  }

  @Delete('suppliers/:id')
  @RequirePermissions('references:delete')
  @ApiOperation({ summary: 'Delete supplier' })
  deleteSupplier(@Param('id', ParseUUIDPipe) id: string) {
    return this.referencesService.deleteSupplier(id);
  }

  @Post('brands')
  @RequirePermissions('references:create')
  @ApiOperation({ summary: 'Create brand' })
  createBrand(@Body() dto: CreateBrandDto) {
    return this.referencesService.createBrand(dto);
  }

  @Get('brands')
  @RequirePermissions('references:read')
  @ApiOperation({ summary: 'List brands' })
  findBrands() {
    return this.referencesService.findBrands();
  }

  @Get('brands/:id')
  @RequirePermissions('references:read')
  @ApiOperation({ summary: 'Get brand' })
  findBrand(@Param('id', ParseUUIDPipe) id: string) {
    return this.referencesService.findBrand(id);
  }

  @Patch('brands/:id')
  @RequirePermissions('references:update')
  @ApiOperation({ summary: 'Update brand' })
  updateBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.referencesService.updateBrand(id, dto);
  }

  @Delete('brands/:id')
  @RequirePermissions('references:delete')
  @ApiOperation({ summary: 'Delete brand' })
  deleteBrand(@Param('id', ParseUUIDPipe) id: string) {
    return this.referencesService.deleteBrand(id);
  }

  @Post('collections')
  @RequirePermissions('references:create')
  @ApiOperation({ summary: 'Create product collection' })
  createProductCollection(@Body() dto: CreateProductCollectionDto) {
    return this.referencesService.createProductCollection(dto);
  }

  @Get('collections')
  @RequirePermissions('references:read')
  @ApiOperation({ summary: 'List product collections' })
  @ApiQuery({ name: 'brandId', required: false })
  findProductCollections(@Query('brandId') brandId?: string) {
    return this.referencesService.findProductCollections(brandId);
  }

  @Get('collections/:id')
  @RequirePermissions('references:read')
  @ApiOperation({ summary: 'Get product collection' })
  findProductCollection(@Param('id', ParseUUIDPipe) id: string) {
    return this.referencesService.findProductCollection(id);
  }

  @Patch('collections/:id')
  @RequirePermissions('references:update')
  @ApiOperation({ summary: 'Update product collection' })
  updateProductCollection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductCollectionDto,
  ) {
    return this.referencesService.updateProductCollection(id, dto);
  }

  @Delete('collections/:id')
  @RequirePermissions('references:delete')
  @ApiOperation({ summary: 'Delete product collection' })
  deleteProductCollection(@Param('id', ParseUUIDPipe) id: string) {
    return this.referencesService.deleteProductCollection(id);
  }
}
