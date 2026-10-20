import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseStatus, StockMovementType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import type {
  CancelPurchaseDto,
  CreatePurchaseDto,
  PurchaseListQueryDto,
  ReceivePurchaseDto,
  RecordPurchasePaymentDto,
  ReturnPurchaseDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto.js';

type UploadedInvoice = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true, contactName: true, phone: true, email: true } },
  branch: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, displayName: true } },
  approvedBy: { select: { id: true, displayName: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
    },
    orderBy: { productName: 'asc' as const },
  },
  receipts: {
    include: {
      receivedBy: { select: { id: true, displayName: true } },
      items: {
        include: {
          purchaseItem: { select: { id: true, productName: true, sku: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true, costPrice: true } },
        },
      },
    },
    orderBy: { receivedAt: 'desc' as const },
  },
  payments: { orderBy: { paidAt: 'desc' as const } },
  returns: {
    include: { items: true },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.PurchaseInclude;

@Injectable()
export class PurchaseService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async list(userId: string, query: PurchaseListQueryDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.PurchaseWhereInput = {
      tenantId: context.tenantId,
      ...(context.branchId ? { branchId: context.branchId } : {}),
      ...(query.status && { status: query.status }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.search && {
        OR: [
          { purchaseNumber: { contains: query.search.trim(), mode: 'insensitive' } },
          { supplier: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
          {
            items: {
              some: { productName: { contains: query.search.trim(), mode: 'insensitive' } },
            },
          },
        ],
      }),
    };
    const [total, items] = await Promise.all([
      this.database.client.purchase.count({ where }),
      this.database.client.purchase.findMany({
        where,
        include: PURCHASE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { purchaseNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: items.map((purchase) => this.presentPurchase(purchase)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(userId: string, purchaseId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const purchase = await this.findPurchase(context.tenantId, context.branchId, purchaseId);
    const [auditHistory, supplierBalance] = await Promise.all([
      this.database.client.auditEvent.findMany({
        where: {
          tenantId: context.tenantId,
          resourceType: 'SHOP_PURCHASE',
          resourceId: purchaseId,
        },
        select: {
          id: true,
          action: true,
          outcome: true,
          metadata: true,
          createdAt: true,
          actorUser: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.supplierOutstandingBalance(context.tenantId, purchase.supplierId, purchase.currency),
    ]);
    const result = this.presentPurchase(purchase);
    return {
      ...result,
      supplier: { ...result.supplier, ...supplierBalance },
      auditHistory,
    };
  }

  async create(userId: string, dto: CreatePurchaseDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'create',
    });
    const branchId = dto.branchId === undefined ? context.branchId : dto.branchId;
    if (context.branchId && branchId !== context.branchId) {
      throw new BadRequestException('Purchases must be created for your assigned branch.');
    }
    await this.assertSupplier(context.tenantId, dto.supplierId);
    await this.assertBranch(context.tenantId, branchId);
    const items = await this.prepareItems(context.tenantId, branchId, dto.items);
    const transportCost = new Prisma.Decimal(dto.transportCost ?? 0);
    const totals = this.calculateTotals(items, transportCost);
    const purchase = await this.database.client.purchase.create({
      data: {
        tenantId: context.tenantId,
        branchId,
        supplierId: dto.supplierId,
        createdByUserId: userId,
        purchaseNumber: this.number('PO'),
        currency: (dto.currency ?? 'KES').toUpperCase(),
        ...totals,
        transportCost,
        notes: dto.notes?.trim() || null,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        items: { create: items },
      },
      include: PURCHASE_INCLUDE,
    });
    await this.audit(context.tenantId, branchId, userId, 'SHOP_PURCHASE_CREATED', purchase.id, {
      purchaseNumber: purchase.purchaseNumber,
      total: purchase.total.toString(),
    });
    return this.presentPurchase(purchase);
  }

  async update(userId: string, purchaseId: string, dto: UpdatePurchaseDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const existing = await this.findPurchase(context.tenantId, context.branchId, purchaseId);
    if (existing.status !== PurchaseStatus.DRAFT) {
      throw new ConflictException('Only draft purchases can be edited.');
    }
    const supplierId = dto.supplierId ?? existing.supplierId;
    const branchId = dto.branchId === undefined ? existing.branchId : dto.branchId;
    if (context.branchId && branchId !== context.branchId) {
      throw new BadRequestException('Purchases must remain within your assigned branch.');
    }
    await this.assertSupplier(context.tenantId, supplierId);
    await this.assertBranch(context.tenantId, branchId);
    const preparedItems = dto.items
      ? await this.prepareItems(context.tenantId, branchId, dto.items)
      : undefined;
    const totals = preparedItems
      ? this.calculateTotals(
          preparedItems,
          new Prisma.Decimal(dto.transportCost ?? existing.transportCost),
        )
      : {
          subtotal: existing.subtotal,
          taxTotal: existing.taxTotal,
          total: existing.total
            .sub(existing.transportCost)
            .add(
              dto.transportCost === undefined
                ? existing.transportCost
                : new Prisma.Decimal(dto.transportCost),
            ),
        };
    const transportCost = new Prisma.Decimal(dto.transportCost ?? existing.transportCost);
    const updated = await this.database.client.$transaction(async (tx) => {
      const locked = await this.lockPurchase(tx, context.tenantId, context.branchId, purchaseId);
      if (locked.status !== PurchaseStatus.DRAFT) {
        throw new ConflictException('Only draft purchases can be edited.');
      }
      if (preparedItems) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId } });
      }
      return tx.purchase.update({
        where: { id: purchaseId },
        data: {
          supplierId,
          branchId,
          ...(dto.currency !== undefined && { currency: dto.currency.toUpperCase() }),
          ...(dto.expectedAt !== undefined && {
            expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
          ...totals,
          transportCost,
          ...(preparedItems && { items: { create: preparedItems } }),
        },
        include: PURCHASE_INCLUDE,
      });
    });
    await this.audit(context.tenantId, branchId, userId, 'SHOP_PURCHASE_UPDATED', purchaseId);
    return this.presentPurchase(updated);
  }

  async send(userId: string, purchaseId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    return this.database.client.$transaction(async (tx) => {
      const purchase = await this.lockPurchase(tx, context.tenantId, context.branchId, purchaseId);
      if (purchase.status !== PurchaseStatus.DRAFT) {
        throw new ConflictException('Only draft purchases can be sent.');
      }
      const updated = await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: PurchaseStatus.SENT,
          sentAt: new Date(),
          approvedByUserId: userId,
          approvedAt: new Date(),
        },
        include: PURCHASE_INCLUDE,
      });
      await this.audit(
        context.tenantId,
        purchase.branchId,
        userId,
        'SHOP_PURCHASE_SENT',
        purchaseId,
        undefined,
        tx,
      );
      return this.presentPurchase(updated);
    });
  }

  async receive(userId: string, purchaseId: string, dto: ReceivePurchaseDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    this.assertUnique(
      dto.items.map((item) => item.purchaseItemId),
      'Each purchase item can appear only once per GRN.',
    );
    const expiryFloor = this.startOfToday();
    for (const line of dto.items) {
      if (line.quantity + (line.quantityRejected ?? 0) < 1) {
        throw new BadRequestException('Each GRN line must include accepted or rejected quantity.');
      }
      if (line.quantity > 0 && (!line.batchNumber?.trim() || !line.expiryDate)) {
        throw new BadRequestException('Accepted stock requires a batch number and expiry date.');
      }
      if (line.quantity > 0 && new Date(line.expiryDate!) < expiryFloor) {
        throw new BadRequestException('Cannot receive stock with an expired batch date.');
      }
    }
    return this.database.client.$transaction(async (tx) => {
      const purchase = await this.lockPurchase(tx, context.tenantId, context.branchId, purchaseId);
      await this.lockSupplier(tx, context.tenantId, purchase.supplierId);
      if (![PurchaseStatus.SENT, PurchaseStatus.PARTIALLY_RECEIVED].includes(purchase.status as any)) {
        throw new ConflictException('Only sent or partially received purchases can be received.');
      }
      const purchaseItems = await tx.purchaseItem.findMany({
        where: { purchaseId },
        select: { productId: true },
      });
      const productIds = [...new Set(purchaseItems.map((item) => item.productId))].sort();
      if (productIds.length > 0) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "products"
          WHERE "tenantId" = ${context.tenantId}::uuid
            AND "id" IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY "id"
          FOR UPDATE
        `;
      }
      const lockedItems = await tx.purchaseItem.findMany({
        where: { purchaseId },
        include: { product: true },
      });
      const itemById = new Map(lockedItems.map((item) => [item.id, item]));
      for (const line of dto.items) {
        const item = itemById.get(line.purchaseItemId);
        if (!item) throw new BadRequestException('A GRN item does not belong to this purchase.');
        const rejectedQuantity = line.quantityRejected ?? 0;
        if (
          item.receivedQuantity + item.rejectedQuantity + line.quantity + rejectedQuantity >
          item.quantity
        ) {
          throw new BadRequestException(
            `Accepted and rejected quantities exceed the remaining order quantity for ${item.productName}.`,
          );
        }
        const product = await tx.product.findFirst({
          where: { id: item.productId, tenantId: context.tenantId },
          select: { branchId: true },
        });
        if (!product || !this.productBelongsToBranch(product.branchId, purchase.branchId)) {
          throw new BadRequestException(
            `${item.productName} is not available at this purchase branch.`,
          );
        }
      }

      const receipt = await tx.purchaseReceipt.create({
        data: {
          tenantId: context.tenantId,
          purchaseId,
          receivedByUserId: userId,
          receiptNumber: this.number('GRN'),
          invoiceReference: dto.invoiceReference?.trim() || null,
          notes: dto.notes?.trim() || null,
        },
      });
      for (const line of dto.items) {
        const item = itemById.get(line.purchaseItemId)!;
        const rejectedQuantity = line.quantityRejected ?? 0;
        const unitCost = new Prisma.Decimal(line.unitCost ?? item.unitCost);
        let batch: { id: string } | null = null;
        if (line.quantity > 0) {
          const expiryDate = new Date(`${line.expiryDate!.slice(0, 10)}T00:00:00.000Z`);
          const existingBatch = await tx.productBatch.findFirst({
            where: {
              tenantId: context.tenantId,
              productId: item.productId,
              batchNumber: line.batchNumber!.trim(),
            },
          });
          if (existingBatch) {
            if (existingBatch.expiryDate.getTime() !== expiryDate.getTime()) {
              throw new ConflictException(
                'The batch number already exists with a different expiry date.',
              );
            }
            const existingQuantity = existingBatch.quantity;
            batch = await tx.productBatch.update({
              where: { id: existingBatch.id },
              data: {
                quantity: { increment: line.quantity },
                costPrice: this.weightedAverage(
                  existingBatch.costPrice,
                  existingQuantity,
                  unitCost,
                  line.quantity,
                ),
              },
            });
          } else {
            batch = await tx.productBatch.create({
              data: {
                tenantId: context.tenantId,
                productId: item.productId,
                batchNumber: line.batchNumber!.trim(),
                expiryDate,
                quantity: line.quantity,
                costPrice: unitCost,
                supplierName: purchase.supplier.name,
              },
            });
          }
          const priorProduct = item.product;
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQuantity: { increment: line.quantity },
              costPrice: this.weightedAverage(
                priorProduct.costPrice,
                priorProduct.stockQuantity,
                unitCost,
                line.quantity,
              ),
              ...(line.sellingPrice !== undefined && {
                sellingPrice: new Prisma.Decimal(line.sellingPrice),
                price: new Prisma.Decimal(line.sellingPrice),
              }),
            },
          });
        }
        const receiptItem = await tx.purchaseReceiptItem.create({
          data: {
            receiptId: receipt.id,
            purchaseItemId: item.id,
            batchId: batch?.id ?? null,
            quantity: line.quantity,
            quantityRejected: rejectedQuantity,
            unitCost,
            sellingPrice:
              line.sellingPrice === undefined ? null : new Prisma.Decimal(line.sellingPrice),
            shelfLocation: line.shelfLocation?.trim() || null,
          },
        });
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: {
            receivedQuantity: { increment: line.quantity },
            rejectedQuantity: { increment: rejectedQuantity },
          },
        });
        if (batch && line.quantity > 0) {
          await tx.stockMovement.create({
            data: {
              tenantId: context.tenantId,
              userId,
              productId: item.productId,
              batchId: batch.id,
              type: StockMovementType.RECEIVE,
              quantity: line.quantity,
              reason: `Purchase ${purchase.purchaseNumber} received: GRN ${receipt.receiptNumber}`,
              purchaseReceiptItemId: receiptItem.id,
            },
          });
        }
      }
      const counts = await tx.purchaseItem.findMany({
        where: { purchaseId },
        select: { quantity: true, receivedQuantity: true, rejectedQuantity: true },
      });
      const fullyReceived = counts.every(
        (item) => item.receivedQuantity + item.rejectedQuantity >= item.quantity,
      );
      const updated = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: fullyReceived ? PurchaseStatus.RECEIVED : PurchaseStatus.PARTIALLY_RECEIVED,
          ...(fullyReceived && { receivedAt: new Date() }),
        },
        include: PURCHASE_INCLUDE,
      });
      await this.audit(
        context.tenantId,
        purchase.branchId,
        userId,
        'SHOP_PURCHASE_RECEIVED',
        purchaseId,
        {
          receiptNumber: receipt.receiptNumber,
          itemCount: dto.items.length,
        },
        tx,
      );
      return { receipt, purchase: this.presentPurchase(updated) };
    });
  }

  async recordPayment(userId: string, purchaseId: string, dto: RecordPurchasePaymentDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    return this.database.client.$transaction(async (tx) => {
      const purchase = await this.lockPurchase(tx, context.tenantId, context.branchId, purchaseId);
      await this.lockSupplier(tx, context.tenantId, purchase.supplierId);
      if (
        [PurchaseStatus.DRAFT, PurchaseStatus.CANCELLED, PurchaseStatus.RETURNED].includes(
          purchase.status as any,
        )
      ) {
        throw new ConflictException('Payment can be recorded only for an active sent purchase.');
      }
      const supplierBalance = await this.getSupplierBalances(
        context.tenantId,
        purchase.supplierId,
        purchase.currency,
        tx,
      );
      const outstanding = new Prisma.Decimal(
        supplierBalance.outstandingBalances.find(
          (balance) => balance.currency === purchase.currency,
        )?.amount ?? 0,
      );
      if (new Prisma.Decimal(dto.amount).greaterThan(outstanding)) {
        throw new BadRequestException(
          `Payment exceeds the ${purchase.currency} supplier balance of ${outstanding.toFixed(2)}.`,
        );
      }
      const newAmountPaid = new Prisma.Decimal(purchase.amountPaid).add(dto.amount);
      if (newAmountPaid.greaterThan(purchase.total)) {
        throw new BadRequestException('Payment amount exceeds the purchase amount due.');
      }
      const payment = await tx.purchasePayment.create({
        data: {
          tenantId: context.tenantId,
          purchaseId,
          recordedByUserId: userId,
          method: dto.method,
          amount: new Prisma.Decimal(dto.amount),
          reference: dto.reference?.trim() || null,
          ...(dto.paidAt ? { paidAt: dto.paidAt } : {}),
        },
      });
      const updated = await tx.purchase.update({
        where: { id: purchaseId },
        data: { amountPaid: newAmountPaid },
        include: PURCHASE_INCLUDE,
      });
      await this.audit(
        context.tenantId,
        purchase.branchId,
        userId,
        'SHOP_PURCHASE_PAYMENT_RECORDED',
        purchaseId,
        {
          paymentId: payment.id,
          amount: payment.amount.toString(),
          method: payment.method,
        },
        tx,
      );
      return { payment, purchase: this.presentPurchase(updated) };
    });
  }

  async cancel(userId: string, purchaseId: string, dto: CancelPurchaseDto = {}) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    return this.database.client.$transaction(async (tx) => {
      const purchase = await this.lockPurchase(tx, context.tenantId, context.branchId, purchaseId);
      if (![PurchaseStatus.DRAFT, PurchaseStatus.SENT].includes(purchase.status as any)) {
        throw new ConflictException('Only unreceived draft or sent purchases can be cancelled.');
      }
      const [received, payments] = await Promise.all([
        tx.purchaseItem.aggregate({
          where: { purchaseId },
          _sum: { receivedQuantity: true, rejectedQuantity: true },
        }),
        tx.purchasePayment.count({ where: { purchaseId } }),
      ]);
      if (
        (received._sum.receivedQuantity ?? 0) > 0 ||
        (received._sum.rejectedQuantity ?? 0) > 0 ||
        payments > 0
      ) {
        throw new ConflictException(
          'Purchases with received stock or recorded payments cannot be cancelled.',
        );
      }
      const updated = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: PurchaseStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: dto.reason?.trim() || 'Cancelled by user.',
        },
        include: PURCHASE_INCLUDE,
      });
      await this.audit(
        context.tenantId,
        purchase.branchId,
        userId,
        'SHOP_PURCHASE_CANCELLED',
        purchaseId,
        {
          reason: dto.reason?.trim() || 'Cancelled by user.',
        },
        tx,
      );
      return this.presentPurchase(updated);
    });
  }

  async returnStock(userId: string, purchaseId: string, dto: ReturnPurchaseDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    this.assertUnique(
      dto.items.map((item) => item.purchaseItemId),
      'Each purchase item can appear only once per return.',
    );
    return this.database.client.$transaction(async (tx) => {
      const purchase = await this.lockPurchase(tx, context.tenantId, context.branchId, purchaseId);
      await this.lockSupplier(tx, context.tenantId, purchase.supplierId);
      if (![PurchaseStatus.RECEIVED, PurchaseStatus.PARTIALLY_RETURNED].includes(purchase.status as any)) {
        throw new ConflictException('Only fully received purchases can be returned.');
      }
      const returnRecord = await tx.purchaseReturn.create({
        data: {
          tenantId: context.tenantId,
          purchaseId,
          recordedByUserId: userId,
          returnNumber: this.number('PR'),
          reason: dto.reason.trim(),
        },
      });
      for (const line of dto.items) {
        const item = await tx.purchaseItem.findFirst({
          where: { id: line.purchaseItemId, purchaseId },
          include: { product: true },
        });
        if (!item) throw new BadRequestException('A return item does not belong to this purchase.');
        if (line.quantity > item.receivedQuantity - item.returnedQuantity) {
          throw new BadRequestException(
            `Return quantity exceeds unreturned received stock for ${item.productName}.`,
          );
        }
        const receiptItems = await tx.purchaseReceiptItem.findMany({
          where: { purchaseItemId: item.id, batchId: { not: null } },
          include: { batch: true },
          orderBy: [{ batch: { expiryDate: 'asc' } }, { id: 'asc' }],
        });
        const previousReturns = await tx.purchaseReturnItem.groupBy({
          by: ['receiptItemId'],
          where: { purchaseItemId: item.id },
          _sum: { quantity: true },
        });
        const returnedByBatch = new Map(
          previousReturns
            .filter((entry) => entry.receiptItemId)
            .map((entry) => [entry.receiptItemId!, entry._sum.quantity ?? 0]),
        );
        let remaining = line.quantity;
        for (const receiptItem of receiptItems) {
          if (remaining <= 0) break;
          if (!receiptItem.batchId || !receiptItem.batch) continue;
          const allocatable = Math.min(
            receiptItem.batch.quantity,
            Math.max(receiptItem.quantity - (returnedByBatch.get(receiptItem.id) ?? 0), 0),
            remaining,
          );
          if (allocatable <= 0) continue;
          const batchUpdated = await tx.productBatch.updateMany({
            where: {
              id: receiptItem.batchId,
              tenantId: context.tenantId,
              quantity: { gte: allocatable },
            },
            data: { quantity: { decrement: allocatable } },
          });
          if (batchUpdated.count !== 1)
            throw new ConflictException('Batch stock changed while processing the return.');
          const productUpdated = await tx.$executeRaw`
            UPDATE "products"
            SET "stockQuantity" = "stockQuantity" - ${allocatable},
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${item.productId}::uuid
              AND "tenantId" = ${context.tenantId}::uuid
              AND "stockQuantity" - "reservedStock" >= ${allocatable}
          `;
          if (productUpdated !== 1)
            throw new ConflictException('Product stock changed while processing the return.');
          const returnItem = await tx.purchaseReturnItem.create({
            data: {
              returnId: returnRecord.id,
              purchaseItemId: item.id,
              receiptItemId: receiptItem.id,
              batchId: receiptItem.batchId,
              quantity: allocatable,
              unitCost: receiptItem.unitCost,
            },
          });
          await tx.stockMovement.create({
            data: {
              tenantId: context.tenantId,
              userId,
              productId: item.productId,
              batchId: receiptItem.batchId,
              type: StockMovementType.PURCHASE_RETURN,
              quantity: -allocatable,
              reason: `Purchase ${purchase.purchaseNumber} returned: ${dto.reason.trim()}`,
              purchaseReturnItemId: returnItem.id,
            },
          });
          remaining -= allocatable;
        }
        if (remaining > 0) {
          throw new ConflictException(
            `Insufficient stock from this purchase to return ${item.productName}.`,
          );
        }
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });
      }
      const [returnedItems, previousReturnItems, purchaseItems] = await Promise.all([
        tx.purchaseReturnItem.findMany({
          where: { returnId: returnRecord.id },
          include: { purchaseItem: { select: { unitCost: true, taxRate: true } } },
        }),
        tx.purchaseReturnItem.findMany({
          where: { purchaseItem: { purchaseId }, returnId: { not: returnRecord.id } },
          include: { purchaseItem: { select: { unitCost: true } } },
        }),
        tx.purchaseItem.findMany({
          where: { purchaseId },
          select: { quantity: true, unitCost: true },
        }),
      ]);
      const orderedBase = purchaseItems.reduce(
        (sum, item) => sum.add(item.unitCost.mul(item.quantity)),
        new Prisma.Decimal(0),
      );
      let creditAmount = new Prisma.Decimal(0);
      let returnedTransportWeight = new Prisma.Decimal(0);
      const previousReturnedTransportWeight = previousReturnItems.reduce(
        (sum, item) => sum.add(item.purchaseItem.unitCost.mul(item.quantity)),
        new Prisma.Decimal(0),
      );
      for (const item of returnedItems) {
        const lineBase = item.unitCost.mul(item.quantity);
        creditAmount = creditAmount.add(
          lineBase.add(lineBase.mul(item.purchaseItem.taxRate).div(100).toDecimalPlaces(2)),
        );
        returnedTransportWeight = returnedTransportWeight.add(
          item.purchaseItem.unitCost.mul(item.quantity),
        );
      }
      if (!orderedBase.isZero()) {
        const previouslyCreditedTransport = purchase.transportCost
          .mul(previousReturnedTransportWeight)
          .div(orderedBase)
          .toDecimalPlaces(2);
        const cumulativelyCreditedTransport = purchase.transportCost
          .mul(previousReturnedTransportWeight.add(returnedTransportWeight))
          .div(orderedBase)
          .toDecimalPlaces(2);
        creditAmount = creditAmount.add(
          cumulativelyCreditedTransport.sub(previouslyCreditedTransport),
        );
      }
      const supplierReturnRows = await tx.$queryRaw<
        Array<{
          id: string;
          returnNumber: string;
          creditAmount: Prisma.Decimal;
          returnedAt: Date;
        }>
      >`
        INSERT INTO "supplier_returns" (
          "id", "tenantId", "supplierId", "purchaseReturnId", "recordedByUserId",
          "returnNumber", "currency", "creditAmount", "reason", "returnedAt"
        )
        VALUES (
          ${randomUUID()}::uuid, ${context.tenantId}::uuid, ${purchase.supplierId}::uuid,
          ${returnRecord.id}::uuid, ${userId}::uuid, ${returnRecord.returnNumber},
          ${purchase.currency}, ${creditAmount.toFixed(2)}::decimal(12,2),
          ${dto.reason.trim()}, ${returnRecord.createdAt}
        )
        RETURNING "id", "returnNumber", "creditAmount", "returnedAt"
      `;
      const supplierReturn = supplierReturnRows[0];
      if (!supplierReturn) throw new ConflictException('Supplier return could not be recorded.');
      const items = await tx.purchaseItem.findMany({
        where: { purchaseId },
        select: { receivedQuantity: true, returnedQuantity: true },
      });
      const allReturned = items.every((item) => item.returnedQuantity >= item.receivedQuantity);
      const updated = await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: allReturned ? PurchaseStatus.RETURNED : PurchaseStatus.PARTIALLY_RETURNED },
        include: PURCHASE_INCLUDE,
      });
      await this.audit(
        context.tenantId,
        purchase.branchId,
        userId,
        'SHOP_PURCHASE_RETURNED',
        purchaseId,
        {
          returnNumber: returnRecord.returnNumber,
          reason: dto.reason.trim(),
          supplierReturnId: supplierReturn.id,
          creditAmount: supplierReturn.creditAmount.toString(),
        },
        tx,
      );
      return { return: returnRecord, supplierReturn, purchase: this.presentPurchase(updated) };
    });
  }

  async uploadInvoice(userId: string, purchaseId: string, file: UploadedInvoice) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const purchase = await this.findPurchase(context.tenantId, context.branchId, purchaseId);
    const allowed = new Map([
      ['application/pdf', 'pdf'],
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
    ]);
    const extension = allowed.get(file.mimetype);
    const signatureIsValid =
      (file.mimetype === 'application/pdf' &&
        file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) ||
      (file.mimetype === 'image/jpeg' &&
        file.buffer.length >= 3 &&
        file.buffer[0] === 0xff &&
        file.buffer[1] === 0xd8 &&
        file.buffer[2] === 0xff) ||
      (file.mimetype === 'image/png' &&
        file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    if (!extension || !signatureIsValid || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new BadRequestException(
        'Invoice must be a PDF, JPEG, or PNG file no larger than 10 MB.',
      );
    }
    const key = `tenants/${context.tenantId}/purchases/${purchase.id}/invoice-${randomUUID()}.${extension}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    try {
      const updated = await this.database.client.purchase.update({
        where: { id: purchase.id },
        data: {
          invoiceStorageKey: key,
          invoiceFileName: file.originalname.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255),
          invoiceMimeType: file.mimetype,
        },
        select: { id: true, invoiceFileName: true, invoiceMimeType: true, updatedAt: true },
      });
      if (purchase.invoiceStorageKey) {
        await this.storage.delete(purchase.invoiceStorageKey).catch(() => undefined);
      }
      await this.audit(
        context.tenantId,
        purchase.branchId,
        userId,
        'SHOP_PURCHASE_INVOICE_UPLOADED',
        purchase.id,
      );
      return updated;
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async downloadInvoice(userId: string, purchaseId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const purchase = await this.findPurchase(context.tenantId, context.branchId, purchaseId);
    if (!purchase.invoiceStorageKey || !purchase.invoiceMimeType) {
      throw new NotFoundException('No invoice has been uploaded for this purchase.');
    }
    return {
      buffer: await this.storage.get(purchase.invoiceStorageKey),
      contentType: purchase.invoiceMimeType,
      fileName: purchase.invoiceFileName ?? 'invoice',
    };
  }

  async export(userId: string, query: PurchaseListQueryDto, format: 'csv' | 'xlsx') {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const where: Prisma.PurchaseWhereInput = {
      tenantId: context.tenantId,
      ...(context.branchId ? { branchId: context.branchId } : {}),
      ...(query.status && { status: query.status }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.search && {
        OR: [
          { purchaseNumber: { contains: query.search.trim(), mode: 'insensitive' } },
          { supplier: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
        ],
      }),
    };
    const purchases = await this.database.client.purchase.findMany({
      where,
      include: { supplier: { select: { name: true } }, items: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const rows = purchases.map((purchase) => [
      purchase.purchaseNumber,
      purchase.status as any,
      purchase.supplier.name,
      purchase.branchId ?? '',
      purchase.currency,
      purchase.subtotal.toString(),
      purchase.taxTotal.toString(),
      purchase.transportCost.toString(),
      purchase.total.toString(),
      purchase.amountPaid.toString(),
      purchase.total.sub(purchase.amountPaid).toString(),
      purchase.createdAt.toISOString(),
      purchase.expectedAt?.toISOString() ?? '',
      purchase.items
        .map((item) => `${item.productName} (${item.quantity} @ ${item.unitCost})`)
        .join('; '),
    ]);
    const headers = [
      'Purchase number',
      'Status',
      'Supplier',
      'Branch ID',
      'Currency',
      'Subtotal',
      'Tax',
      'Transport cost',
      'Total',
      'Amount paid',
      'Balance due',
      'Created at',
      'Expected at',
      'Items',
    ];
    if (format === 'csv') {
      return {
        buffer: Buffer.from(
          [headers, ...rows]
            .map((row) => row.map((value) => this.csv(value)).join(','))
            .join('\r\n'),
        ),
        contentType: 'text/csv; charset=utf-8',
        extension: 'csv',
      };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Purchases');
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = Math.min(
        45,
        Math.max(
          14,
          ...sheet
            .getColumn(column.number ?? 1)
            .values.slice(1)
            .map((value) => String(value ?? '').length + 2),
        ),
      );
    });
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }

  private async prepareItems(
    tenantId: string,
    branchId: string | null,
    input: CreatePurchaseDto['items'],
  ) {
    this.assertUnique(
      input.map((item) => item.productId),
      'A product can appear only once in a purchase.',
    );
    const products = await this.database.client.product.findMany({
      where: { tenantId, id: { in: input.map((item) => item.productId) } },
      select: { id: true, name: true, sku: true, branchId: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    return input.map((line) => {
      const product = productById.get(line.productId);
      if (!product) throw new BadRequestException('One or more selected products are unavailable.');
      if (!this.productBelongsToBranch(product.branchId, branchId)) {
        throw new BadRequestException(`${product.name} is not available at the selected branch.`);
      }
      const unitCost = new Prisma.Decimal(line.unitCost);
      const base = unitCost.mul(line.quantity);
      const taxRate = new Prisma.Decimal(line.taxRate ?? 0);
      const lineTotal = base.add(base.mul(taxRate).div(100).toDecimalPlaces(2));
      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: line.quantity,
        unitCost,
        taxRate,
        lineTotal,
      };
    });
  }

  private calculateTotals(
    items: Array<{
      quantity: number;
      unitCost: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }>,
    transportCost: Prisma.Decimal,
  ) {
    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    for (const item of items) {
      const base = item.unitCost.mul(item.quantity);
      subtotal = subtotal.add(base);
      taxTotal = taxTotal.add(item.lineTotal.sub(base));
    }
    const total = subtotal.add(taxTotal).add(transportCost);
    if (total.greaterThan('9999999999.99')) {
      throw new BadRequestException('Purchase total exceeds the supported monetary limit.');
    }
    return { subtotal, taxTotal, total };
  }

  private async assertSupplier(tenantId: string, supplierId: string) {
    const supplier = await this.database.client.supplier.findFirst({
      where: { id: supplierId, tenantId, isActive: true, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException('The selected supplier is unavailable.');
  }

  private async assertBranch(tenantId: string, branchId: string | null) {
    if (!branchId) return;
    const branch = await this.database.client.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('The selected branch is unavailable.');
  }

  private productBelongsToBranch(productBranchId: string | null, branchId: string | null) {
    return productBranchId === null || productBranchId === branchId;
  }

  private async findPurchase(tenantId: string, branchId: string | null, purchaseId: string) {
    const purchase = await this.database.client.purchase.findFirst({
      where: { id: purchaseId, tenantId, ...(branchId ? { branchId } : {}) },
      include: PURCHASE_INCLUDE,
    });
    if (!purchase) throw new NotFoundException('Purchase not found.');
    return purchase;
  }

  private presentPurchase<
    T extends {
      id: string;
      total: Prisma.Decimal;
      amountPaid: Prisma.Decimal;
      invoiceStorageKey: string | null;
      invoiceFileName: string | null;
    },
  >(purchase: T) {
    const { invoiceStorageKey: _privateKey, ...safePurchase } = purchase;
    return {
      ...safePurchase,
      balance: purchase.total.sub(purchase.amountPaid).toString(),
      invoiceUrl: purchase.invoiceFileName ? `/v1/shop/purchases/${purchase.id}/invoice` : null,
    };
  }

  async getSupplierBalances(
    tenantId: string,
    supplierId: string,
    purchaseCurrency: string,
    tx: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ) {
    return this.supplierOutstandingBalance(tenantId, supplierId, purchaseCurrency, tx);
  }

  private async supplierOutstandingBalance(
    tenantId: string,
    supplierId: string,
    purchaseCurrency: string,
    client: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ) {
    const purchases = await client.purchase.findMany({
      where: { tenantId, supplierId },
      select: {
        currency: true,
        transportCost: true,
        amountPaid: true,
        items: {
          select: { id: true, quantity: true, unitCost: true, taxRate: true },
        },
        receipts: {
          select: {
            items: {
              select: {
                purchaseItemId: true,
                quantity: true,
                unitCost: true,
              },
            },
          },
        },
        returns: {
          select: {
            items: {
              select: {
                purchaseItemId: true,
                quantity: true,
                unitCost: true,
              },
            },
          },
        },
      },
    });

    const supplierPayments = await client.supplierPayment.findMany({
      where: { tenantId, supplierId },
      select: { currency: true, amount: true },
    });

    const balances = new Map<string, Prisma.Decimal>();
    balances.set(purchaseCurrency, new Prisma.Decimal(0));
    for (const purchase of purchases) {
      const zero = new Prisma.Decimal(0);
      const itemById = new Map(purchase.items.map((item) => [item.id, item]));
      const orderedBase = purchase.items.reduce(
        (sum, item) => sum.add(item.unitCost.mul(item.quantity)),
        zero,
      );
      let receivedBase = zero;
      let receivedTax = zero;
      let receivedTransportWeight = zero;
      for (const receipt of purchase.receipts) {
        for (const line of receipt.items) {
          const item = itemById.get(line.purchaseItemId);
          if (!item) continue;
          const base = line.unitCost.mul(line.quantity);
          receivedBase = receivedBase.add(base);
          receivedTax = receivedTax.add(base.mul(item.taxRate).div(100).toDecimalPlaces(2));
          receivedTransportWeight = receivedTransportWeight.add(item.unitCost.mul(line.quantity));
        }
      }

      let returnedBase = zero;
      let returnedTax = zero;
      let returnedTransportWeight = zero;
      for (const returnRecord of purchase.returns) {
        for (const line of returnRecord.items) {
          const item = itemById.get(line.purchaseItemId);
          if (!item) continue;
          const base = line.unitCost.mul(line.quantity);
          returnedBase = returnedBase.add(base);
          returnedTax = returnedTax.add(base.mul(item.taxRate).div(100).toDecimalPlaces(2));
          returnedTransportWeight = returnedTransportWeight.add(item.unitCost.mul(line.quantity));
        }
      }

      let transportAccrued = zero;
      let transportCredited = zero;
      if (!orderedBase.isZero()) {
        transportAccrued = purchase.transportCost
          .mul(receivedTransportWeight)
          .div(orderedBase)
          .toDecimalPlaces(2);
        transportCredited = purchase.transportCost
          .mul(returnedTransportWeight)
          .div(orderedBase)
          .toDecimalPlaces(2);
      }
      const purchaseBalance = receivedBase
        .add(receivedTax)
        .add(transportAccrued)
        .sub(returnedBase)
        .sub(returnedTax)
        .sub(transportCredited)
        .sub(purchase.amountPaid);
      balances.set(
        purchase.currency,
        (balances.get(purchase.currency) ?? zero).add(purchaseBalance),
      );
    }
    for (const payment of supplierPayments) {
      balances.set(
        payment.currency,
        (balances.get(payment.currency) ?? new Prisma.Decimal(0)).sub(payment.amount),
      );
    }

    const outstandingBalances = [...balances.entries()]
      .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
      .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));
    return {
      outstandingBalances,
      outstandingBalance: outstandingBalances.length === 1 ? outstandingBalances[0]!.amount : null,
      outstandingBalanceCurrency:
        outstandingBalances.length === 1 ? outstandingBalances[0]!.currency : null,
    };
  }

  private async lockPurchase(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    purchaseId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "purchases"
      WHERE "id" = ${purchaseId}::uuid
        AND "tenantId" = ${tenantId}::uuid
        ${branchId ? Prisma.sql`AND "branchId" = ${branchId}::uuid` : Prisma.empty}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('Purchase not found.');
    return tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { supplier: { select: { name: true } } },
    });
  }

  private async lockSupplier(tx: Prisma.TransactionClient, tenantId: string, supplierId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "suppliers"
      WHERE "id" = ${supplierId}::uuid AND "tenantId" = ${tenantId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('Supplier not found.');
  }

  private weightedAverage(
    oldCost: Prisma.Decimal,
    oldQuantity: number,
    newCost: Prisma.Decimal,
    newQuantity: number,
  ) {
    const totalQuantity = oldQuantity + newQuantity;
    if (!totalQuantity) return newCost;
    return oldCost
      .mul(oldQuantity)
      .add(newCost.mul(newQuantity))
      .div(totalQuantity)
      .toDecimalPlaces(2);
  }

  private async audit(
    tenantId: string,
    branchId: string | null,
    userId: string,
    action: string,
    purchaseId: string,
    metadata?: Prisma.InputJsonValue,
    tx: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId,
        branchId,
        actorUserId: userId,
        action,
        resourceType: 'SHOP_PURCHASE',
        resourceId: purchaseId,
        outcome: 'SUCCESS',
        ...(metadata && { metadata }),
      },
    });
  }

  private number(prefix: string) {
    return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private assertUnique(values: string[], message: string) {
    if (new Set(values).size !== values.length) throw new BadRequestException(message);
  }

  private startOfToday() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
  }

  private csv(value: unknown) {
    let text = String(value ?? '');
    if (/^[\t\r=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
}
