import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductPrescriptionClass,
  ProductStatus,
  ProductVatStatus,
  ProductVisibility,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import ExcelJS from 'exceljs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import { CreateProductCatalogueDto } from './dto/shop.dto.js';
import type {
  BulkPriceUpdateDto,
  CreateSupplierDto,
  ProductListQueryDto,
  UpdateProductCatalogueDto,
} from './dto/shop.dto.js';

type UploadedProductFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const PRODUCT_SELECT = {
  id: true,
  tenantId: true,
  branchId: true,
  categoryId: true,
  supplierId: true,
  name: true,
  sku: true,
  barcode: true,
  brand: true,
  brandName: true,
  genericName: true,
  strength: true,
  dosageForm: true,
  packSize: true,
  manufacturer: true,
  ppbRegistrationNumber: true,
  prescriptionClass: true,
  prescriptionRequired: true,
  vatStatus: true,
  costPrice: true,
  price: true,
  sellingPrice: true,
  wholesalePrice: true,
  taxRate: true,
  stockQuantity: true,
  reservedStock: true,
  minimumStockLevel: true,
  reorderLevel: true,
  reorderQuantity: true,
  storageInstructions: true,
  requiresColdChain: true,
  imageUrl: true,
  imageStorageKey: true,
  imageMimeType: true,
  status: true,
  visibility: true,
  notes: true,
  description: true,
  unit: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

@Injectable()
export class ShopProductService {
  private readonly logger = new Logger(ShopProductService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async listProducts(userId: string, query: ProductListQueryDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const clauses = this.buildProductFilter(context.tenantId, context.branchId, query);
    const whereSql = Prisma.join(clauses, ' AND ');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const orderBy = this.productOrder(query.sortBy ?? 'name', query.sortOrder ?? 'asc');
    const [countResult, idRows] = await Promise.all([
      this.database.client.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "products" p WHERE ${whereSql}`,
      ),
      this.database.client.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT p."id" FROM "products" p WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      ),
    ]);
    const total = Number(countResult[0]?.count ?? 0n);
    if (idRows.length === 0) {
      return { items: [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }
    const idOrder = new Map(idRows.map(({ id }, index) => [id, index]));
    const records = await this.database.client.product.findMany({
      where: { id: { in: idRows.map(({ id }) => id) }, tenantId: context.tenantId },
      include: {
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        batches: { select: { quantity: true, costPrice: true, expiryDate: true } },
      },
    });
    const items = records
      .sort((left, right) => (idOrder.get(left.id) ?? 0) - (idOrder.get(right.id) ?? 0))
      .map((product) => {
        const batchQuantity = product.batches.reduce((sum, batch) => sum + batch.quantity, 0);
        const unbatchedQuantity = Math.max(product.stockQuantity - batchQuantity, 0);
        const totalStockValue = product.batches.reduce(
          (sum, batch) => sum + batch.quantity * Number(batch.costPrice),
          unbatchedQuantity * Number(product.costPrice),
        );
        return {
          ...product,
          brandName: product.brandName ?? product.brand,
          sellingPrice: product.sellingPrice.toString(),
          price: product.sellingPrice.toString(),
          totalStock: product.stockQuantity,
          totalStockValue: totalStockValue.toFixed(2),
          earliestExpiry:
            product.batches
              .filter((batch) => batch.quantity > 0)
              .sort((left, right) => left.expiryDate.getTime() - right.expiryDate.getTime())[0]
              ?.expiryDate ?? null,
          batches: undefined,
        };
      });
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getProduct(userId: string, productId: string) {
    const { tenantId, branchId } = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const product = await this.findAccessibleProduct(tenantId, branchId, productId);
    const batches = await this.database.client.productBatch.findMany({
      where: { tenantId, productId },
      orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'desc' }],
    });
    const saleItems = await this.database.client.saleItem.findMany({
      where: { productId, sale: { tenantId } },
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            status: true,
            paymentStatus: true,
            createdAt: true,
            customerName: true,
          },
        },
      },
      orderBy: { sale: { createdAt: 'desc' } },
      take: 100,
    });
    const latestSale = saleItems[0];
    const latestBatch = [...batches].sort(
      (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime(),
    )[0];
    const activeBatches = batches.filter((batch) => batch.quantity > 0);
    const batchedStock = batches.reduce((sum, batch) => sum + batch.quantity, 0);
    const stockValue = batches.reduce(
      (sum, batch) => sum + batch.quantity * Number(batch.costPrice),
      Math.max(product.stockQuantity - batchedStock, 0) * Number(product.costPrice),
    );
    const movements = await this.database.client.stockMovement.findMany({
      where: { tenantId, productId },
      include: {
        batch: { select: { batchNumber: true, expiryDate: true, costPrice: true } },
        sale: { select: { saleNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const lastSalePrice = Number(latestSale?.unitPrice ?? product.sellingPrice);
    const lastPurchasePrice = Number(latestBatch?.costPrice ?? product.costPrice);
    return {
      ...product,
      brandName: product.brandName ?? product.brand,
      sellingPrice: product.sellingPrice.toString(),
      price: product.sellingPrice.toString(),
      totalStock: product.stockQuantity,
      totalStockValue: stockValue.toFixed(2),
      earliestExpiry:
        activeBatches.sort(
          (left, right) => left.expiryDate.getTime() - right.expiryDate.getTime(),
        )[0]?.expiryDate ?? null,
      lastPurchasePrice: lastPurchasePrice.toFixed(2),
      lastSalePrice: lastSalePrice.toFixed(2),
      profitMargin:
        lastSalePrice > 0
          ? (((lastSalePrice - lastPurchasePrice) / lastSalePrice) * 100).toFixed(2)
          : null,
      batches,
      salesHistory: saleItems,
      purchaseHistory: movements.filter((movement) => movement.type === StockMovementType.RECEIVE),
      stockMovementHistory: movements,
    };
  }

  async createProduct(userId: string, dto: CreateProductCatalogueDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'create',
    });
    try {
      return await this.database.client.$transaction(async (tx) =>
        this.createProductInTransaction(tx, context.tenantId, context.branchId, userId, dto),
      );
    } catch (error) {
      this.throwProductConflict(error);
    }
  }

  async updateProduct(userId: string, productId: string, dto: UpdateProductCatalogueDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const existing = await this.findAccessibleProduct(
      context.tenantId,
      context.branchId,
      productId,
    );
    await this.assertReferences(context.tenantId, context.branchId, dto);
    const status = dto.status;
    const updateData: Prisma.ProductUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.sku !== undefined && { sku: dto.sku.trim() }),
      ...(dto.categoryId !== undefined && {
        category: dto.categoryId ? { connect: { id: dto.categoryId } } : { disconnect: true },
      }),
      ...(dto.branchId !== undefined && {
        branch: dto.branchId ? { connect: { id: dto.branchId } } : { disconnect: true },
      }),
      ...(dto.supplierId !== undefined && {
        supplier: dto.supplierId ? { connect: { id: dto.supplierId } } : { disconnect: true },
      }),
      ...(dto.brandName !== undefined && {
        brandName: dto.brandName?.trim() || null,
        brand: dto.brandName?.trim() || null,
      }),
      ...(dto.genericName !== undefined && { genericName: dto.genericName?.trim() || null }),
      ...(dto.strength !== undefined && { strength: dto.strength?.trim() || null }),
      ...(dto.dosageForm !== undefined && { dosageForm: dto.dosageForm?.trim() || null }),
      ...(dto.packSize !== undefined && { packSize: dto.packSize?.trim() || null }),
      ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer?.trim() || null }),
      ...(dto.barcode !== undefined && { barcode: dto.barcode?.trim() || null }),
      ...(dto.ppbRegistrationNumber !== undefined && {
        ppbRegistrationNumber: dto.ppbRegistrationNumber?.trim() || null,
        ppbRegistrationNo: dto.ppbRegistrationNumber?.trim() || null,
      }),
      ...(dto.prescriptionClass !== undefined && {
        prescriptionClass: dto.prescriptionClass,
        prescriptionRequired: dto.prescriptionClass !== ProductPrescriptionClass.OTC,
      }),
      ...(dto.vatStatus !== undefined && { vatStatus: dto.vatStatus }),
      ...(dto.sellingPrice !== undefined && {
        sellingPrice: new Prisma.Decimal(dto.sellingPrice),
        price: new Prisma.Decimal(dto.sellingPrice),
      }),
      ...(dto.costPrice !== undefined && { costPrice: new Prisma.Decimal(dto.costPrice) }),
      ...(dto.wholesalePrice !== undefined && {
        wholesalePrice: dto.wholesalePrice === null ? null : new Prisma.Decimal(dto.wholesalePrice),
      }),
      ...(dto.taxRate !== undefined && { taxRate: new Prisma.Decimal(dto.taxRate) }),
      ...(dto.minimumStockLevel !== undefined && {
        minimumStockLevel: dto.minimumStockLevel,
      }),
      ...(dto.reorderLevel !== undefined && { reorderLevel: dto.reorderLevel }),
      ...(dto.reorderQuantity !== undefined && { reorderQuantity: dto.reorderQuantity }),
      ...(dto.storageInstructions !== undefined && {
        storageInstructions: dto.storageInstructions?.trim() || null,
      }),
      ...(dto.requiresColdChain !== undefined && { requiresColdChain: dto.requiresColdChain }),
      ...(dto.status !== undefined && {
        status: dto.status,
        visibility:
          dto.status === ProductStatus.DISCONTINUED
            ? ProductVisibility.DISCONTINUED
            : dto.status === ProductStatus.INACTIVE
              ? ProductVisibility.HIDDEN
              : existing.visibility === ProductVisibility.DISCONTINUED
                ? ProductVisibility.IN_STORE_ONLY
                : existing.visibility,
      }),
      ...(dto.visibility !== undefined && { visibility: dto.visibility }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
      ...(dto.unit !== undefined && { unit: dto.unit.trim() }),
    };
    try {
      return await this.database.client.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id: productId, tenantId: context.tenantId },
          data: updateData,
        });
        await this.audit(
          tx,
          context.tenantId,
          userId,
          'SHOP_PRODUCT_UPDATED',
          product.id,
          product.branchId,
        );
        return product;
      });
    } catch (error) {
      this.throwProductConflict(error);
    }
  }

  async deleteProduct(userId: string, productId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const existing = await this.findAccessibleProduct(
      context.tenantId,
      context.branchId,
      productId,
    );
    return this.database.client.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: existing.id, tenantId: context.tenantId },
        data: { status: ProductStatus.DISCONTINUED, visibility: ProductVisibility.DISCONTINUED },
      });
      await this.audit(
        tx,
        context.tenantId,
        userId,
        'SHOP_PRODUCT_DISCONTINUED',
        product.id,
        product.branchId,
      );
      return { id: product.id, status: product.status };
    });
  }

  async listSuppliers(userId: string) {
    const { tenantId } = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    return this.database.client.supplier.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSupplier(userId: string, dto: CreateSupplierDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'create',
    });
    try {
      return await this.database.client.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({
          data: {
            tenantId: context.tenantId,
            name: dto.name.trim(),
            contactName: dto.contactName?.trim() || null,
            phone: dto.phone?.trim() || null,
            email: dto.email?.trim() || null,
          },
        });
        await this.audit(
          tx,
          context.tenantId,
          userId,
          'SHOP_SUPPLIER_CREATED',
          supplier.id,
          context.branchId,
        );
        return supplier;
      });
    } catch (error) {
      this.throwProductConflict(error);
    }
  }

  async uploadImage(userId: string, productId: string, file: UploadedProductFile) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const product = await this.findAccessibleProduct(context.tenantId, context.branchId, productId);
    if (
      !file ||
      file.buffer.length === 0 ||
      file.buffer.length > 5 * 1024 * 1024 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Select an image no larger than 5 MB.');
    }
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensions[file.mimetype];
    if (!extension || !this.matchesImageSignature(file.mimetype, file.buffer)) {
      throw new BadRequestException('Only valid JPG, PNG, and WEBP product images are accepted.');
    }
    const storageKey = `tenant/${context.tenantId}/products/${product.id}/${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    try {
      const imageUrl = `/v1/shop/products/${product.id}/image`;
      const updated = await this.database.client.$transaction(async (tx) => {
        const saved = await tx.product.update({
          where: { id: product.id, tenantId: context.tenantId },
          data: {
            imageUrl,
            imageStorageKey: storageKey,
            imageMimeType: file.mimetype,
            images: [imageUrl],
          },
        });
        await this.audit(
          tx,
          context.tenantId,
          userId,
          'SHOP_PRODUCT_IMAGE_UPLOADED',
          product.id,
          product.branchId,
        );
        return saved;
      });
      if (product.imageStorageKey) {
        await this.storage.delete(product.imageStorageKey).catch((error: unknown) => {
          this.logger.error(`Unable to delete replaced product image ${product.id}`, error);
        });
      }
      return { id: updated.id, imageUrl: updated.imageUrl };
    } catch (error) {
      await this.storage.delete(storageKey).catch((cleanupError: unknown) => {
        this.logger.error(
          `Unable to clean up failed product image upload ${product.id}`,
          cleanupError,
        );
      });
      throw error;
    }
  }

  async downloadImage(userId: string, productId: string) {
    const { tenantId, branchId } = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const product = await this.findAccessibleProduct(tenantId, branchId, productId);
    if (!product.imageStorageKey || !product.imageMimeType) {
      throw new NotFoundException('Product image not found.');
    }
    return {
      buffer: await this.storage.get(product.imageStorageKey),
      contentType: product.imageMimeType,
    };
  }

  async downloadPatientProductImage(productId: string) {
    const product = await this.database.client.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        visibility: 'ONLINE',
        prescriptionClass: 'OTC',
        prescriptionRequired: false,
        tenant: {
          status: 'ACTIVE',
          deletedAt: null,
          shopSettings: { is: { acceptingOrders: true } },
        },
      },
      select: { imageStorageKey: true, imageMimeType: true },
    });
    if (!product?.imageStorageKey || !product.imageMimeType) {
      throw new NotFoundException('Product image not found.');
    }
    return {
      buffer: await this.storage.get(product.imageStorageKey),
      contentType: product.imageMimeType,
    };
  }

  async importProducts(userId: string, file: UploadedProductFile) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'create',
    });
    const rows = await this.readImportRows(file);
    if (rows.length === 0)
      throw new BadRequestException('The import file contains no product rows.');
    if (rows.length > 500)
      throw new BadRequestException('Import a maximum of 500 products at a time.');

    const categories = await this.database.client.productCategory.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true },
    });
    const suppliers = await this.database.client.supplier.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, name: true },
    });
    const categoryByName = new Map(
      categories.map((category) => [this.normalize(category.name), category.id]),
    );
    const supplierByName = new Map(
      suppliers.map((supplier) => [this.normalize(supplier.name), supplier.id]),
    );
    const results: Array<{
      row: number;
      status: 'created' | 'error';
      id?: string;
      message?: string;
    }> = [];

    for (const [index, rawRow] of rows.entries()) {
      const mapped = this.mapImportRow(rawRow);
      const categoryName = mapped.categoryName;
      const supplierName = mapped.supplierName;
      if (typeof categoryName === 'string' && categoryName) {
        const categoryId = categoryByName.get(this.normalize(categoryName));
        if (!categoryId) {
          results.push({
            row: index + 2,
            status: 'error',
            message: `Unknown category "${categoryName}".`,
          });
          continue;
        }
        mapped.categoryId = categoryId;
      }
      if (typeof supplierName === 'string' && supplierName) {
        const supplierId = supplierByName.get(this.normalize(supplierName));
        if (!supplierId) {
          results.push({
            row: index + 2,
            status: 'error',
            message: `Unknown supplier "${supplierName}".`,
          });
          continue;
        }
        mapped.supplierId = supplierId;
      }
      delete mapped.categoryName;
      delete mapped.supplierName;
      const dto = plainToInstance(CreateProductCatalogueDto, mapped);
      const validationErrors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      if (
        validationErrors.length > 0 ||
        (dto.sellingPrice === undefined && dto.price === undefined)
      ) {
        results.push({
          row: index + 2,
          status: 'error',
          message:
            validationErrors
              .flatMap((validationError) => Object.values(validationError.constraints ?? {}))
              .join('; ') || 'Selling price is required.',
        });
        continue;
      }
      try {
        const product = await this.database.client.$transaction(async (tx) =>
          this.createProductInTransaction(tx, context.tenantId, context.branchId, userId, dto),
        );
        results.push({ row: index + 2, status: 'created', id: product.id });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          results.push({
            row: index + 2,
            status: 'error',
            message: 'SKU or barcode already exists.',
          });
          continue;
        }
        if (error instanceof BadRequestException) {
          results.push({ row: index + 2, status: 'error', message: error.message });
          continue;
        }
        throw error;
      }
    }
    return {
      imported: results.filter((result) => result.status === 'created').length,
      failed: results.filter((result) => result.status === 'error').length,
      rows: results,
    };
  }

  async exportProducts(userId: string, query: ProductListQueryDto, format: 'csv' | 'xlsx') {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const clauses = this.buildProductFilter(context.tenantId, context.branchId, query);
    const rows = await this.database.client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT p."id" FROM "products" p WHERE ${Prisma.join(clauses, ' AND ')} ORDER BY p."name" ASC LIMIT 10001`,
    );
    if (rows.length > 10000) {
      throw new BadRequestException('Narrow the filters to export no more than 10,000 products.');
    }
    const products = await this.database.client.product.findMany({
      where: { tenantId: context.tenantId, id: { in: rows.map(({ id }) => id) } },
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const headers = [
      'Name',
      'Brand',
      'Generic name',
      'Strength',
      'Dosage form',
      'Pack size',
      'Category',
      'Supplier',
      'Barcode',
      'SKU',
      'Prescription class',
      'VAT status',
      'Cost price',
      'Selling price',
      'Wholesale price',
      'Stock',
      'Minimum stock level',
      'Reorder level',
      'Reorder quantity',
      'Status',
    ];
    const data = products.map((product) => [
      product.name,
      product.brandName ?? product.brand ?? '',
      product.genericName ?? '',
      product.strength ?? '',
      product.dosageForm ?? '',
      product.packSize ?? '',
      product.category?.name ?? '',
      product.supplier?.name ?? '',
      product.barcode ?? '',
      product.sku,
      product.prescriptionClass,
      product.vatStatus,
      product.costPrice.toString(),
      product.sellingPrice.toString(),
      product.wholesalePrice?.toString() ?? '',
      product.stockQuantity,
      product.minimumStockLevel,
      product.reorderLevel,
      product.reorderQuantity,
      product.status,
    ]);
    if (format === 'csv') {
      const csv = [headers, ...data]
        .map((row) => row.map((value) => this.csvCell(value)).join(','))
        .join('\r\n');
      return {
        buffer: Buffer.from(`\uFEFF${csv}`, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        extension: 'csv',
      };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(headers);
    data.forEach((row) => sheet.addRow(row.map((value) => this.safeSpreadsheetCell(value))));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const output = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(output),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }

  async bulkUpdatePrices(userId: string, dto: BulkPriceUpdateDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const products = await this.database.client.product.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: dto.productIds },
        ...(context.branchId ? { OR: [{ branchId: null }, { branchId: context.branchId }] } : {}),
      },
      select: { id: true, price: true, branchId: true },
    });
    if (products.length !== dto.productIds.length) {
      throw new NotFoundException('One or more selected products are unavailable.');
    }
    return this.database.client.$transaction(async (tx) => {
      const updated = [];
      for (const product of products) {
        const current = Number(product.price);
        const next =
          dto.mode === 'SET'
            ? dto.value
            : dto.mode === 'INCREASE_PERCENT'
              ? current * (1 + dto.value / 100)
              : current * (1 - dto.value / 100);
        if (!Number.isFinite(next) || next < 0) {
          throw new BadRequestException(`Price update would make product ${product.id} negative.`);
        }
        const price = new Prisma.Decimal(next.toFixed(2));
        const saved = await tx.product.update({
          where: { id: product.id, tenantId: context.tenantId },
          data: { price, sellingPrice: price },
          select: { id: true, sellingPrice: true },
        });
        await this.audit(
          tx,
          context.tenantId,
          userId,
          'SHOP_PRODUCT_PRICE_UPDATED',
          product.id,
          product.branchId,
          { oldPrice: current.toFixed(2), newPrice: saved.sellingPrice.toString(), mode: dto.mode },
        );
        updated.push(saved);
      }
      return { updatedCount: updated.length, products: updated };
    });
  }

  private async createProductInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    userId: string,
    dto: CreateProductCatalogueDto,
  ) {
    await this.assertReferences(tenantId, branchId, dto);
    const sellingPriceValue = dto.sellingPrice ?? dto.price;
    if (sellingPriceValue === undefined) {
      throw new BadRequestException('Selling price is required.');
    }
    const brandName = dto.brandName?.trim() || dto.brand?.trim() || null;
    const prescriptionClass =
      dto.prescriptionClass ??
      (dto.prescriptionRequired
        ? ProductPrescriptionClass.PRESCRIPTION_ONLY
        : ProductPrescriptionClass.OTC);
    const status =
      dto.status ??
      (dto.visibility === ProductVisibility.DISCONTINUED
        ? ProductStatus.DISCONTINUED
        : dto.visibility === ProductVisibility.HIDDEN
          ? ProductStatus.INACTIVE
          : ProductStatus.ACTIVE);
    const visibility =
      dto.visibility ??
      (status === ProductStatus.DISCONTINUED
        ? ProductVisibility.DISCONTINUED
        : status === ProductStatus.INACTIVE
          ? ProductVisibility.HIDDEN
          : ProductVisibility.IN_STORE_ONLY);
    const product = await tx.product.create({
      data: {
        tenantId,
        branchId: dto.branchId ?? branchId,
        categoryId: dto.categoryId ?? null,
        supplierId: dto.supplierId ?? null,
        name: dto.name.trim(),
        sku: dto.sku.trim(),
        barcode: dto.barcode?.trim() || null,
        brand: brandName,
        brandName,
        genericName: dto.genericName?.trim() || null,
        strength: dto.strength?.trim() || null,
        dosageForm: dto.dosageForm?.trim() || null,
        packSize: dto.packSize?.trim() || null,
        manufacturer: dto.manufacturer?.trim() || null,
        ppbRegistrationNo: dto.ppbRegistrationNumber?.trim() || null,
        ppbRegistrationNumber: dto.ppbRegistrationNumber?.trim() || null,
        prescriptionClass,
        prescriptionRequired: prescriptionClass !== ProductPrescriptionClass.OTC,
        vatStatus: dto.vatStatus ?? ProductVatStatus.VATABLE,
        costPrice: new Prisma.Decimal(dto.costPrice ?? 0),
        price: new Prisma.Decimal(sellingPriceValue),
        sellingPrice: new Prisma.Decimal(sellingPriceValue),
        compareAtPrice:
          dto.compareAtPrice === undefined ? null : new Prisma.Decimal(dto.compareAtPrice),
        wholesalePrice: dto.wholesalePrice == null ? null : new Prisma.Decimal(dto.wholesalePrice),
        taxRate: new Prisma.Decimal(dto.taxRate ?? 0),
        stockQuantity: dto.stockQuantity ?? 0,
        minimumStockLevel: dto.minimumStockLevel ?? dto.reorderLevel ?? 0,
        reorderLevel: dto.reorderLevel ?? dto.minimumStockLevel ?? 0,
        reorderQuantity: dto.reorderQuantity ?? 0,
        storageInstructions: dto.storageInstructions?.trim() || null,
        requiresColdChain: dto.requiresColdChain ?? false,
        status,
        visibility,
        notes: dto.notes?.trim() || null,
        description: dto.description?.trim() || null,
        unit: dto.unit?.trim() || 'unit',
        images: dto.images ?? [],
        tags: dto.tags ?? [],
      },
      select: PRODUCT_SELECT,
    });
    await this.audit(tx, tenantId, userId, 'SHOP_PRODUCT_CREATED', product.id, product.branchId);
    return product;
  }

  private async assertReferences(
    tenantId: string,
    currentBranchId: string | null,
    dto: { categoryId?: string | null; supplierId?: string | null; branchId?: string | null },
  ) {
    if (dto.categoryId) {
      const category = await this.database.client.productCategory.findFirst({
        where: { id: dto.categoryId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!category) throw new BadRequestException('The selected product category is unavailable.');
    }
    if (dto.supplierId) {
      const supplier = await this.database.client.supplier.findFirst({
        where: { id: dto.supplierId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!supplier) throw new BadRequestException('The selected supplier is unavailable.');
    }
    if (dto.branchId) {
      if (currentBranchId && dto.branchId !== currentBranchId) {
        throw new BadRequestException('Products can only be assigned to your active branch.');
      }
      const branch = await this.database.client.branch.findFirst({
        where: { id: dto.branchId, tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('The selected branch is unavailable.');
    }
  }

  private async findAccessibleProduct(
    tenantId: string,
    branchId: string | null,
    productId: string,
  ) {
    const product = await this.database.client.product.findFirst({
      where: {
        id: productId,
        tenantId,
        ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  private buildProductFilter(
    tenantId: string,
    branchId: string | null,
    query: ProductListQueryDto,
  ): Prisma.Sql[] {
    const clauses: Prisma.Sql[] = [Prisma.sql`p."tenantId" = ${tenantId}::uuid`];
    if (branchId) {
      clauses.push(Prisma.sql`(p."branchId" IS NULL OR p."branchId" = ${branchId}::uuid)`);
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      clauses.push(
        Prisma.sql`(p."name" ILIKE ${term} OR p."brandName" ILIKE ${term} OR p."genericName" ILIKE ${term} OR p."sku" ILIKE ${term} OR p."barcode" ILIKE ${term})`,
      );
    }
    if (query.categoryId) clauses.push(Prisma.sql`p."categoryId" = ${query.categoryId}::uuid`);
    if (query.brand) clauses.push(Prisma.sql`p."brandName" ILIKE ${`%${query.brand}%`}`);
    if (query.genericName) {
      clauses.push(Prisma.sql`p."genericName" ILIKE ${`%${query.genericName}%`}`);
    }
    if (query.supplierId) clauses.push(Prisma.sql`p."supplierId" = ${query.supplierId}::uuid`);
    if (query.prescriptionClass) {
      clauses.push(
        Prisma.sql`p."prescriptionClass" = ${query.prescriptionClass}::"ProductPrescriptionClass"`,
      );
    }
    if (query.status) {
      clauses.push(Prisma.sql`p."status" = ${query.status}::"ProductStatus"`);
    }
    if (query.coldChain !== undefined) {
      clauses.push(Prisma.sql`p."requiresColdChain" = ${query.coldChain}`);
    }
    if (query.stockStatus === 'IN_STOCK') clauses.push(Prisma.sql`p."stockQuantity" > 0`);
    if (query.stockStatus === 'OUT_OF_STOCK') clauses.push(Prisma.sql`p."stockQuantity" <= 0`);
    if (query.stockStatus === 'LOW_STOCK') {
      clauses.push(
        Prisma.sql`p."stockQuantity" > 0 AND p."stockQuantity" <= GREATEST(p."minimumStockLevel", p."reorderLevel")`,
      );
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const soon = new Date(today);
    soon.setUTCDate(soon.getUTCDate() + 30);
    if (query.expiryStatus === 'EXPIRED') {
      clauses.push(
        Prisma.sql`(p."expiryDate" < ${today}::date OR EXISTS (SELECT 1 FROM "product_batches" pb WHERE pb."productId" = p."id" AND pb."tenantId" = p."tenantId" AND pb."quantity" > 0 AND pb."expiryDate" < ${today}::date))`,
      );
    }
    if (query.expiryStatus === 'EXPIRING_SOON') {
      clauses.push(
        Prisma.sql`((p."expiryDate" >= ${today}::date AND p."expiryDate" <= ${soon}::date) OR EXISTS (SELECT 1 FROM "product_batches" pb WHERE pb."productId" = p."id" AND pb."tenantId" = p."tenantId" AND pb."quantity" > 0 AND pb."expiryDate" >= ${today}::date AND pb."expiryDate" <= ${soon}::date))`,
      );
    }
    if (query.expiryStatus === 'NO_EXPIRY') {
      clauses.push(
        Prisma.sql`p."expiryDate" IS NULL AND NOT EXISTS (SELECT 1 FROM "product_batches" pb WHERE pb."productId" = p."id" AND pb."tenantId" = p."tenantId" AND pb."quantity" > 0)`,
      );
    }
    return clauses;
  }

  private productOrder(
    sortBy: NonNullable<ProductListQueryDto['sortBy']>,
    direction: 'asc' | 'desc',
  ) {
    const sort = direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    switch (sortBy) {
      case 'sellingPrice':
        return Prisma.sql`p."sellingPrice" ${sort}, p."name" ASC`;
      case 'stockQuantity':
        return Prisma.sql`p."stockQuantity" ${sort}, p."name" ASC`;
      case 'createdAt':
        return Prisma.sql`p."createdAt" ${sort}`;
      case 'earliestExpiry':
        return Prisma.sql`(SELECT MIN(pb."expiryDate") FROM "product_batches" pb WHERE pb."productId" = p."id" AND pb."tenantId" = p."tenantId" AND pb."quantity" > 0) ${sort} NULLS LAST, p."name" ASC`;
      default:
        return Prisma.sql`p."name" ${sort}, p."id" ASC`;
    }
  }

  private async readImportRows(file: UploadedProductFile) {
    if (
      !file ||
      file.buffer.length === 0 ||
      file.buffer.length > 5 * 1024 * 1024 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Select a CSV or Excel file no larger than 5 MB.');
    }
    const extension = file.originalname.toLowerCase().split('.').pop();
    const workbook = new ExcelJS.Workbook();
    if (extension === 'csv') {
      await workbook.csv.read(Readable.from(file.buffer));
    } else if (extension === 'xlsx' && file.buffer.subarray(0, 2).toString() === 'PK') {
      const workbookBuffer = new ArrayBuffer(file.buffer.byteLength);
      new Uint8Array(workbookBuffer).set(file.buffer);
      await workbook.xlsx.load(workbookBuffer);
    } else {
      throw new BadRequestException('Only CSV and .xlsx product files are supported.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return [];
    const headers = sheet.getRow(1).values as Array<ExcelJS.CellValue | undefined>;
    const names = headers.map((value) => this.normalize(this.cellText(value)));
    const rows: Record<string, string>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as Array<ExcelJS.CellValue | undefined>;
      const record: Record<string, string> = {};
      names.forEach((header, columnIndex) => {
        if (header) record[header] = this.cellText(values[columnIndex]);
      });
      if (Object.values(record).some((value) => value.trim())) rows.push(record);
    });
    return rows;
  }

  private mapImportRow(row: Record<string, string>): Record<string, unknown> {
    const aliases: Record<string, string> = {
      name: 'name',
      productname: 'name',
      brand: 'brandName',
      brandname: 'brandName',
      genericname: 'genericName',
      strength: 'strength',
      dosageform: 'dosageForm',
      packsize: 'packSize',
      manufacturer: 'manufacturer',
      supplierid: 'supplierId',
      categoryid: 'categoryId',
      branchid: 'branchId',
      barcode: 'barcode',
      sku: 'sku',
      prescriptionclass: 'prescriptionClass',
      vatstatus: 'vatStatus',
      sellingprice: 'sellingPrice',
      retailprice: 'sellingPrice',
      price: 'sellingPrice',
      category: 'categoryName',
      categoryname: 'categoryName',
      supplier: 'supplierName',
      suppliername: 'supplierName',
      minimumstock: 'minimumStockLevel',
      minimumstocklevel: 'minimumStockLevel',
      reorderlevel: 'reorderLevel',
      reorderquantity: 'reorderQuantity',
      stockquantity: 'stockQuantity',
      costprice: 'costPrice',
      wholesaleprice: 'wholesalePrice',
      taxrate: 'taxRate',
      storageinstructions: 'storageInstructions',
      coldchain: 'requiresColdChain',
      requirescoldchain: 'requiresColdChain',
      ppbregistrationno: 'ppbRegistrationNumber',
      ppbregistrationnumber: 'ppbRegistrationNumber',
      status: 'status',
      notes: 'notes',
      description: 'description',
      unit: 'unit',
      compareatprice: 'compareAtPrice',
      visibility: 'visibility',
      prescriptionrequired: 'prescriptionRequired',
      tags: 'tags',
    };
    const mapped: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(row)) {
      const key = aliases[header];
      if (!key) continue;
      if (
        [
          'sellingPrice',
          'costPrice',
          'wholesalePrice',
          'taxRate',
          'minimumStockLevel',
          'reorderLevel',
          'reorderQuantity',
          'stockQuantity',
        ].includes(key)
      ) {
        mapped[key] = value === '' ? undefined : Number(value.replaceAll(',', ''));
      } else if (key === 'requiresColdChain') {
        if (['true', '1', 'yes'].includes(value.toLowerCase())) mapped[key] = true;
        else if (['false', '0', 'no', ''].includes(value.toLowerCase())) mapped[key] = false;
        else mapped[key] = value;
      } else if (['prescriptionClass', 'vatStatus', 'status', 'visibility'].includes(key)) {
        mapped[key] = value.toUpperCase().replaceAll(' ', '_');
      } else if (key === 'prescriptionRequired') {
        mapped[key] = ['true', '1', 'yes'].includes(value.toLowerCase());
      } else if (key === 'tags') {
        mapped[key] = value
          .split('|')
          .map((tag) => tag.trim())
          .filter(Boolean);
      } else {
        mapped[key] = value;
      }
    }
    return mapped;
  }

  private cellText(value: ExcelJS.CellValue | undefined): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if ('text' in value && typeof value.text === 'string') return value.text;
      if ('result' in value) return this.cellText(value.result as ExcelJS.CellValue | undefined);
      if ('richText' in value) return value.richText.map((part) => part.text).join('');
      return '';
    }
    return String(value);
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private csvCell(value: string | number) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  private safeSpreadsheetCell(value: unknown) {
    if (typeof value !== 'string') return value;
    return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  }

  private matchesImageSignature(mimeType: string, buffer: Buffer) {
    if (mimeType === 'image/jpeg')
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === 'image/png')
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === 'image/webp') {
      return (
        buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
      );
    }
    return false;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorUserId: string,
    action: string,
    resourceId: string,
    branchId: string | null,
    metadata?: Prisma.InputJsonValue,
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId,
        actorUserId,
        ...(branchId && { branchId }),
        action,
        resourceType: 'PRODUCT',
        resourceId,
        outcome: 'SUCCESS',
        ...(metadata && { metadata }),
      },
    });
  }

  private throwProductConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A product with this SKU or barcode already exists.');
    }
    throw error;
  }
}
