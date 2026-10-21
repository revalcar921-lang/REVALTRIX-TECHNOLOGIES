import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import {
  CreateShopCategoryDto,
  CreateShopOrderDto,
  CreateShopPosSaleDto,
  AssignShopOrderDto,
  CancelShopOrderDto,
  HoldShopPosSaleDto,
  RefundShopPosSaleDto,
  RefundShopOrderDto,
  RecordShopOrderPaymentDto,
  ReturnShopOrderDto,
  ReceiveShopPosBatchDto,
  ResumeShopPosSaleDto,
  UpdateShopOrderStatusDto,
  UpdateShopOrderDto,
  UpdateShopProductDto,
  UpdateShopSettingsDto,
  BulkPriceUpdateDto,
  CreateProductCatalogueDto,
  ProductListQueryDto,
  UpdateProductCatalogueDto,
} from './dto/shop.dto.js';
import {
  CancelPurchaseDto,
  CreatePurchaseDto,
  PurchaseListQueryDto,
  ReceivePurchaseDto,
  RecordPurchasePaymentDto,
  ReturnPurchaseDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto.js';
import {
  CreateSupplierProfileDto,
  SupplierListQueryDto,
  SupplierPaymentDto,
  SupplierProductPriceDto,
  SupplierStatementQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto.js';
import { ShopService } from './shop.service.js';
import { BatchService } from './batch.service.js';
import { ShopProductService } from './shop-product.service.js';
import { PurchaseService } from './purchase.service.js';
import { ShopSupplierService } from './shop-supplier.service.js';

@Controller('v1/shop')
@UseGuards(AccessTokenGuard)
export class ShopController {
  constructor(
    private readonly shopService: ShopService,
    private readonly batchService: BatchService,
    private readonly shopProductService: ShopProductService,
    private readonly purchaseService: PurchaseService,
    private readonly supplierService: ShopSupplierService,
  ) {}

  @Get('settings')
  async getSettings(@Req() request: AuthenticatedRequest) {
    return this.shopService.getSettings(request.auth.userId);
  }

  @Patch('settings')
  async updateSettings(@Req() request: AuthenticatedRequest, @Body() dto: UpdateShopSettingsDto) {
    return this.shopService.updateSettings(request.auth.userId, dto);
  }

  @Get('categories')
  async listCategories(@Req() request: AuthenticatedRequest) {
    return this.shopService.listCategories(request.auth.userId);
  }

  @Post('categories')
  async createCategory(@Req() request: AuthenticatedRequest, @Body() dto: CreateShopCategoryDto) {
    return this.shopService.createCategory(request.auth.userId, dto);
  }

  @Get('products')
  async listProducts(@Req() request: AuthenticatedRequest, @Query() query: ProductListQueryDto) {
    return this.shopProductService.listProducts(request.auth.userId, query);
  }

  @Get('patient/products')
  async listPatientProducts(
    @Req() request: AuthenticatedRequest,
    @Query('q') search = '',
    @Query('page') page = '1',
  ) {
    return this.shopService.listPatientProducts(request.auth.userId, search, Number(page));
  }

  @Get('patient/products/:productId/image')
  async downloadPatientProductImage(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Res() response: Response,
  ) {
    const image = await this.shopProductService.downloadPatientProductImage(productId);
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', image.buffer.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.send(image.buffer);
  }

  @Post('patient/orders')
  async createPatientOrder(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateShopOrderDto,
  ) {
    return this.shopService.createPatientOrder(request.auth.userId, dto);
  }

  @Get('products/export')
  async exportProducts(
    @Req() request: AuthenticatedRequest,
    @Query() query: ProductListQueryDto,
    @Query('format') format: string,
    @Res() response: Response,
  ) {
    if (format && format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('Export format must be csv or xlsx.');
    }
    const file = await this.shopProductService.exportProducts(
      request.auth.userId,
      query,
      format === 'xlsx' ? 'xlsx' : 'csv',
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="products.${file.extension}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }

  @Post('products/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importProducts(
    @Req() request: AuthenticatedRequest,
    @UploadedFile()
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select a CSV or Excel product file.');
    return this.shopProductService.importProducts(request.auth.userId, file);
  }

  @Post('products/bulk-price-update')
  async bulkUpdateProductPrices(
    @Req() request: AuthenticatedRequest,
    @Body() dto: BulkPriceUpdateDto,
  ) {
    return this.shopProductService.bulkUpdatePrices(request.auth.userId, dto);
  }

  @Get('suppliers')
  async listProductSuppliers(
    @Req() request: AuthenticatedRequest,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.supplierService.list(request.auth.userId, query);
  }

  @Post('suppliers')
  async createProductSupplier(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSupplierProfileDto,
  ) {
    return this.supplierService.create(request.auth.userId, dto);
  }

  @Get('suppliers/export')
  async exportSuppliers(
    @Req() request: AuthenticatedRequest,
    @Query() query: SupplierListQueryDto,
    @Query('format') format: string,
    @Res() response: Response,
  ) {
    if (format && format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('Export format must be csv or xlsx.');
    }
    const file = await this.supplierService.export(
      request.auth.userId,
      query,
      format === 'xlsx' ? 'xlsx' : 'csv',
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="suppliers.${file.extension}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }

  @Post('suppliers/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importSuppliers(
    @Req() request: AuthenticatedRequest,
    @UploadedFile()
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select a CSV or Excel supplier file.');
    return this.supplierService.import(request.auth.userId, file);
  }

  @Get('suppliers/:supplierId/purchases')
  async listSupplierPurchases(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Query() query: PurchaseListQueryDto,
  ) {
    await this.supplierService.assertExists(request.auth.userId, supplierId);
    return this.purchaseService.list(request.auth.userId, { ...query, supplierId });
  }

  @Get('suppliers/:supplierId/products')
  async listSupplierProducts(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
  ) {
    return this.supplierService.products(request.auth.userId, supplierId);
  }

  @Post('suppliers/:supplierId/products/:productId/prices')
  async setSupplierProductPrice(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: SupplierProductPriceDto,
  ) {
    return this.supplierService.setProductPrice(request.auth.userId, supplierId, productId, dto);
  }

  @Post('suppliers/:supplierId/payments')
  async recordSupplierPayment(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Body() dto: SupplierPaymentDto,
  ) {
    return this.supplierService.recordPayment(request.auth.userId, supplierId, dto);
  }

  @Get('suppliers/:supplierId/statement')
  async getSupplierStatement(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Query() query: SupplierStatementQueryDto,
  ) {
    return this.supplierService.statement(request.auth.userId, supplierId, query);
  }

  @Get('suppliers/:supplierId')
  async getSupplier(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
  ) {
    return this.supplierService.get(request.auth.userId, supplierId);
  }

  @Patch('suppliers/:supplierId')
  async updateSupplier(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(request.auth.userId, supplierId, dto);
  }

  @Put('suppliers/:supplierId')
  async replaceSupplier(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(request.auth.userId, supplierId, dto);
  }

  @Post('suppliers/:supplierId/deactivate')
  async deactivateSupplier(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
  ) {
    return this.supplierService.deactivate(request.auth.userId, supplierId);
  }

  @Delete('suppliers/:supplierId')
  async deleteSupplier(
    @Req() request: AuthenticatedRequest,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
  ) {
    return this.supplierService.deactivate(request.auth.userId, supplierId);
  }

  @Get('purchases/export')
  async exportPurchases(
    @Req() request: AuthenticatedRequest,
    @Query() query: PurchaseListQueryDto,
    @Query('format') format: string,
    @Res() response: Response,
  ) {
    if (format && format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('Export format must be csv or xlsx.');
    }
    const file = await this.purchaseService.export(
      request.auth.userId,
      query,
      format === 'xlsx' ? 'xlsx' : 'csv',
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="purchases.${file.extension}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }

  @Get('purchases')
  async listPurchases(@Req() request: AuthenticatedRequest, @Query() query: PurchaseListQueryDto) {
    return this.purchaseService.list(request.auth.userId, query);
  }

  @Post('purchases')
  async createPurchase(@Req() request: AuthenticatedRequest, @Body() dto: CreatePurchaseDto) {
    return this.purchaseService.create(request.auth.userId, dto);
  }

  @Get('purchases/:purchaseId')
  async getPurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
  ) {
    return this.purchaseService.get(request.auth.userId, purchaseId);
  }

  @Patch('purchases/:purchaseId')
  async updatePurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchaseService.update(request.auth.userId, purchaseId, dto);
  }

  @Put('purchases/:purchaseId')
  async replacePurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchaseService.update(request.auth.userId, purchaseId, dto);
  }

  @Post('purchases/:purchaseId/send')
  async sendPurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
  ) {
    return this.purchaseService.send(request.auth.userId, purchaseId);
  }

  @Post('purchases/:purchaseId/receive')
  async receivePurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Body() dto: ReceivePurchaseDto,
  ) {
    return this.purchaseService.receive(request.auth.userId, purchaseId, dto);
  }

  @Post(['purchases/:purchaseId/payment', 'purchases/:purchaseId/payments'])
  async recordPurchasePayment(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Body() dto: RecordPurchasePaymentDto,
  ) {
    return this.purchaseService.recordPayment(request.auth.userId, purchaseId, dto);
  }

  @Post('purchases/:purchaseId/cancel')
  async cancelPurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Body() dto: CancelPurchaseDto,
  ) {
    return this.purchaseService.cancel(request.auth.userId, purchaseId, dto);
  }

  @Post('purchases/:purchaseId/return')
  async returnPurchase(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Body() dto: ReturnPurchaseDto,
  ) {
    return this.purchaseService.returnStock(request.auth.userId, purchaseId, dto);
  }

  @Get('purchases/:purchaseId/invoice')
  async downloadPurchaseInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Res() response: Response,
  ) {
    const file = await this.purchaseService.downloadInvoice(request.auth.userId, purchaseId);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', file.buffer.length);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, '_')}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(file.buffer);
  }

  @Post(['purchases/:purchaseId/invoice-upload', 'purchases/:purchaseId/invoice'])
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async uploadPurchaseInvoice(
    @Req() request: AuthenticatedRequest,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @UploadedFile()
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select a PDF, JPEG, or PNG invoice file.');
    return this.purchaseService.uploadInvoice(request.auth.userId, purchaseId, file);
  }

  @Post('products')
  async createProduct(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateProductCatalogueDto,
  ) {
    return this.shopProductService.createProduct(request.auth.userId, dto);
  }

  @Get('products/:productId/history')
  async getProductHistory(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.shopProductService.getProduct(request.auth.userId, productId);
  }

  @Get('products/:productId/image')
  async downloadProductImage(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Res() response: Response,
  ) {
    const image = await this.shopProductService.downloadImage(request.auth.userId, productId);
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', image.buffer.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.send(image.buffer);
  }

  @Post('products/:productId/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async uploadProductImage(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @UploadedFile()
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select a product image.');
    return this.shopProductService.uploadImage(request.auth.userId, productId, file);
  }

  @Get('products/:productId')
  async getProduct(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.shopProductService.getProduct(request.auth.userId, productId);
  }

  @Put('products/:productId')
  async updateCatalogueProduct(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: UpdateProductCatalogueDto,
  ) {
    return this.shopProductService.updateProduct(request.auth.userId, productId, dto);
  }

  @Delete('products/:productId')
  async deleteCatalogueProduct(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.shopProductService.deleteProduct(request.auth.userId, productId);
  }

  @Patch('products/:productId')
  async updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param('productId') productId: string,
    @Body() dto: UpdateShopProductDto,
  ) {
    return this.shopService.updateProduct(request.auth.userId, productId, dto);
  }

  @Post('orders')
  async createOrder(@Req() request: AuthenticatedRequest, @Body() dto: CreateShopOrderDto) {
    return this.shopService.createOrder(request.auth.userId, dto);
  }

  @Get('orders')
  async listOrders(@Req() request: AuthenticatedRequest) {
    return this.shopService.listOrders(request.auth.userId);
  }

  @Get('orders/:orderId')
  async getOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.shopService.getOrder(request.auth.userId, orderId);
  }

  @Put('orders/:orderId')
  async updateOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: UpdateShopOrderDto,
  ) {
    return this.shopService.updateOrder(request.auth.userId, orderId, dto);
  }

  @Put('orders/:orderId/status')
  @Patch('orders/:orderId/status')
  async updateOrderStatus(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: UpdateShopOrderStatusDto,
  ) {
    return this.shopService.updateOrderStatus(request.auth.userId, orderId, dto);
  }

  @Put('orders/:orderId/assign')
  async assignOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: AssignShopOrderDto,
  ) {
    return this.shopService.assignOrder(request.auth.userId, orderId, dto);
  }

  @Post('orders/:orderId/payment')
  async recordOrderPayment(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: RecordShopOrderPaymentDto,
  ) {
    return this.shopService.recordOrderPayment(request.auth.userId, orderId, dto);
  }

  @Post('orders/:orderId/refund')
  async refundOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: RefundShopOrderDto,
  ) {
    return this.shopService.refundOrder(request.auth.userId, orderId, dto);
  }

  @Post('orders/:orderId/cancel')
  async cancelOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: CancelShopOrderDto,
  ) {
    return this.shopService.cancelOrder(request.auth.userId, orderId, dto);
  }

  @Post('orders/:orderId/return')
  async returnOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: ReturnShopOrderDto,
  ) {
    return this.shopService.returnOrder(request.auth.userId, orderId, dto);
  }

  @Post('orders/:orderId/delivery-proof')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async uploadOrderDeliveryProof(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @UploadedFile()
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select a delivery-proof file.');
    return this.shopService.uploadDeliveryProof(request.auth.userId, orderId, file);
  }

  @Post('orders/:orderId/whatsapp-update')
  async createOrderWhatsAppUpdate(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.shopService.createOrderWhatsAppUpdate(request.auth.userId, orderId);
  }

  @Get('products/:productId/batches')
  async listProductBatches(
    @Req() request: AuthenticatedRequest,
    @Param('productId') productId: string,
  ) {
    return this.batchService.listProductBatches(request.auth.userId, productId);
  }

  @Get('pos/products/search')
  async searchPosProducts(@Req() request: AuthenticatedRequest, @Query('q') query = '') {
    return this.shopService.searchPosProducts(request.auth.userId, query);
  }

  @Get('pos/batches/:productId')
  async listPosBatches(
    @Req() request: AuthenticatedRequest,
    @Param('productId') productId: string,
  ) {
    return this.shopService.listPosBatches(request.auth.userId, productId);
  }

  @Post('pos/batches/receive')
  async receivePosBatch(@Req() request: AuthenticatedRequest, @Body() dto: ReceiveShopPosBatchDto) {
    return this.shopService.receivePosBatch(request.auth.userId, dto);
  }

  @Post('pos/sale')
  async completePosSale(@Req() request: AuthenticatedRequest, @Body() dto: CreateShopPosSaleDto) {
    return this.shopService.createPosSale(request.auth.userId, dto);
  }

  @Post('pos/hold')
  async holdPosSale(@Req() request: AuthenticatedRequest, @Body() dto: HoldShopPosSaleDto) {
    return this.shopService.holdPosSale(request.auth.userId, dto);
  }

  @Get('pos/held')
  async listHeldPosSales(@Req() request: AuthenticatedRequest) {
    return this.shopService.listHeldPosSales(request.auth.userId);
  }

  @Post('pos/resume')
  async resumePosSale(@Req() request: AuthenticatedRequest, @Body() dto: ResumeShopPosSaleDto) {
    return this.shopService.resumePosSale(request.auth.userId, dto);
  }

  @Get('pos/sales')
  async listPosSales(@Req() request: AuthenticatedRequest) {
    return this.shopService.listPosSales(request.auth.userId);
  }

  @Post('pos/refund')
  async refundPosSale(@Req() request: AuthenticatedRequest, @Body() dto: RefundShopPosSaleDto) {
    return this.shopService.refundPosSale(request.auth.userId, dto);
  }
}
