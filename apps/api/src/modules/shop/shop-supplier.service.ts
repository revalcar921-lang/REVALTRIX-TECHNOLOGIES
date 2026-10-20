import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Readable } from 'node:stream';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import {
  CreateSupplierProfileDto,
  SupplierListQueryDto,
  SupplierPaymentDto,
  SupplierProductPriceDto,
  SupplierStatementQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto.js';
import { PurchaseService } from './purchase.service.js';

type UploadedSupplierFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

const SUPPLIER_INCLUDE = {
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { name: 'asc' as const }] },
  _count: { select: { products: true, purchases: true } },
} satisfies Prisma.SupplierInclude;

@Injectable()
export class ShopSupplierService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly purchases: PurchaseService,
  ) {}

  async list(userId: string, query: SupplierListQueryDto = {}) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const search = query.search?.trim();
    const filters: Prisma.SupplierWhereInput[] = [];
    if (query.status === RecordStatus.INACTIVE) {
      filters.push({ OR: [{ status: RecordStatus.INACTIVE }, { isActive: false }] });
    } else if (query.status === RecordStatus.ACTIVE) {
      filters.push({ status: RecordStatus.ACTIVE, isActive: true });
    } else if (query.status) {
      filters.push({ status: query.status });
    } else {
      filters.push({ status: RecordStatus.ACTIVE, isActive: true });
    }
    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { legalName: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    return this.database.client.supplier.findMany({
      where: { tenantId: context.tenantId, AND: filters },
      include: SUPPLIER_INCLUDE,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async get(userId: string, supplierId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const supplier = await this.findSupplier(context.tenantId, supplierId);
    const balances = await this.purchases.getSupplierBalances(
      context.tenantId,
      supplier.id,
      supplier.defaultCurrency,
    );
    return { ...supplier, ...balances };
  }

  async assertExists(userId: string, supplierId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    await this.findSupplier(context.tenantId, supplierId);
  }

  async create(userId: string, dto: CreateSupplierProfileDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'create',
    });
    if (!dto.name.trim()) throw new BadRequestException('Supplier name cannot be blank.');
    this.assertOnePrimaryContact(dto.contacts ?? []);
    try {
      return await this.database.client.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({
          data: {
            tenantId: context.tenantId,
            ...this.profileData(dto),
            ...(dto.contacts && {
              contacts: {
                create: dto.contacts.map((contact) =>
                  this.contactData(contact, context.tenantId),
                ),
              },
            }),
          },
          include: SUPPLIER_INCLUDE,
        });
        await this.audit(
          tx,
          context.tenantId,
          context.branchId,
          userId,
          'SHOP_SUPPLIER_CREATED',
          supplier.id,
        );
        return supplier;
      });
    } catch (error) {
      this.throwConflict(error);
    }
  }

  async update(userId: string, supplierId: string, dto: UpdateSupplierDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const updateValues = dto as unknown as Record<string, unknown>;
    for (const field of [
      'name',
      'paymentTermsDays',
      'creditLimit',
      'defaultCurrency',
      'status',
      'contacts',
    ]) {
      if (updateValues[field] === null) {
        throw new BadRequestException(`${field} cannot be null; omit it or provide a value.`);
      }
    }
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Supplier name cannot be blank.');
    }
    await this.findSupplier(context.tenantId, supplierId);
    if (dto.contacts) this.assertOnePrimaryContact(dto.contacts);
    try {
      return await this.database.client.$transaction(async (tx) => {
        const data: Prisma.SupplierUpdateInput = {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.contactName !== undefined && { contactName: this.clean(dto.contactName) }),
          ...(dto.phone !== undefined && { phone: this.clean(dto.phone) }),
          ...(dto.email !== undefined && { email: this.clean(dto.email) }),
          ...(dto.legalName !== undefined && { legalName: this.clean(dto.legalName) }),
          ...(dto.registrationNumber !== undefined && {
            registrationNumber: this.clean(dto.registrationNumber),
          }),
          ...(dto.taxId !== undefined && { taxId: this.clean(dto.taxId) }),
          ...(dto.address !== undefined && { address: this.clean(dto.address) }),
          ...(dto.city !== undefined && { city: this.clean(dto.city) }),
          ...(dto.county !== undefined && { county: this.clean(dto.county) }),
          ...(dto.country !== undefined && { country: this.clean(dto.country) }),
          ...(dto.postalCode !== undefined && { postalCode: this.clean(dto.postalCode) }),
          ...(dto.website !== undefined && { website: this.clean(dto.website) }),
          ...(dto.notes !== undefined && { notes: this.clean(dto.notes) }),
          ...(dto.paymentTermsDays !== undefined && { paymentTermsDays: dto.paymentTermsDays }),
          ...(dto.creditLimit !== undefined && {
            creditLimit: new Prisma.Decimal(dto.creditLimit),
          }),
          ...(dto.defaultCurrency !== undefined && {
            defaultCurrency: dto.defaultCurrency.toUpperCase(),
          }),
          ...(dto.status !== undefined && {
            status: dto.status,
            isActive: dto.status === RecordStatus.ACTIVE,
          }),
          ...(dto.contacts && {
            contacts: {
              deleteMany: {},
              create: dto.contacts.map((contact) => this.contactData(contact, context.tenantId)),
            },
          }),
        };
        const supplier = await tx.supplier.update({
          where: { id: supplierId, tenantId: context.tenantId },
          data,
          include: SUPPLIER_INCLUDE,
        });
        await this.audit(
          tx,
          context.tenantId,
          context.branchId,
          userId,
          'SHOP_SUPPLIER_UPDATED',
          supplierId,
          {
            changedFields: Object.keys(dto),
          },
        );
        return supplier;
      });
    } catch (error) {
      this.throwConflict(error);
    }
  }

  async deactivate(userId: string, supplierId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const existing = await this.findSupplier(context.tenantId, supplierId);
    if (existing.status === RecordStatus.INACTIVE)
      return { id: supplierId, status: existing.status };
    return this.database.client.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplierId, tenantId: context.tenantId },
        data: { status: RecordStatus.INACTIVE, isActive: false },
      });
      await this.audit(
        tx,
        context.tenantId,
        context.branchId,
        userId,
        'SHOP_SUPPLIER_DEACTIVATED',
        supplierId,
      );
      return { id: supplierId, status: RecordStatus.INACTIVE };
    });
  }

  async recordPayment(userId: string, supplierId: string, dto: SupplierPaymentDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    return this.database.client.$transaction(async (tx) => {
      const supplier = await this.lockSupplier(tx, context.tenantId, supplierId);
      if (supplier.status !== RecordStatus.ACTIVE || !supplier.isActive) {
        throw new ConflictException('Payments cannot be recorded for an inactive supplier.');
      }
      const balance = await this.purchases.getSupplierBalances(
        context.tenantId,
        supplierId,
        dto.currency.toUpperCase(),
        tx,
      );
      const due = balance.outstandingBalances.find(
        (item) => item.currency === dto.currency.toUpperCase(),
      );
      const outstanding = new Prisma.Decimal(due?.amount ?? 0);
      const amount = new Prisma.Decimal(dto.amount);
      if (outstanding.lessThanOrEqualTo(0)) {
        throw new ConflictException(
          `There is no positive outstanding balance in ${dto.currency.toUpperCase()} to pay.`,
        );
      }
      if (amount.greaterThan(outstanding)) {
        throw new BadRequestException(
          `Payment exceeds the ${dto.currency.toUpperCase()} outstanding balance of ${outstanding.toFixed(2)}.`,
        );
      }
      const payment = await tx.supplierPayment.create({
        data: {
          tenantId: context.tenantId,
          supplierId,
          recordedByUserId: userId,
          method: dto.method,
          amount,
          currency: dto.currency.toUpperCase(),
          reference: dto.reference?.trim() || null,
          notes: dto.notes?.trim() || null,
          ...(dto.paidAt && { paidAt: new Date(dto.paidAt) }),
        },
      });
      await this.audit(
        tx,
        context.tenantId,
        context.branchId,
        userId,
        'SHOP_SUPPLIER_PAYMENT_RECORDED',
        supplierId,
        {
          paymentId: payment.id,
          amount: payment.amount.toString(),
          currency: payment.currency,
          method: payment.method,
          reference: payment.reference,
        },
      );
      const updatedBalance = await this.purchases.getSupplierBalances(
        context.tenantId,
        supplierId,
        supplier.defaultCurrency,
        tx,
      );
      return { payment, ...updatedBalance };
    });
  }

  async statement(userId: string, supplierId: string, query: SupplierStatementQueryDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    const supplier = await this.findSupplier(context.tenantId, supplierId);
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException('The statement start date must not be after its end date.');
    }
    const purchases = await this.database.client.purchase.findMany({
      where: { tenantId: context.tenantId, supplierId },
      select: {
        id: true,
        purchaseNumber: true,
        currency: true,
        transportCost: true,
        items: {
          select: { id: true, unitCost: true, taxRate: true, quantity: true },
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            receivedAt: true,
            items: { select: { purchaseItemId: true, quantity: true, unitCost: true } },
          },
        },
        payments: {
          select: { id: true, amount: true, method: true, reference: true, paidAt: true },
        },
        returns: {
          select: {
            id: true,
            returnNumber: true,
            createdAt: true,
            supplierReturn: {
              select: { id: true, returnNumber: true, creditAmount: true, returnedAt: true },
            },
            items: { select: { purchaseItemId: true, quantity: true, unitCost: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const supplierPayments = await this.database.client.supplierPayment.findMany({
      where: { tenantId: context.tenantId, supplierId },
      select: {
        id: true,
        amount: true,
        currency: true,
        method: true,
        reference: true,
        notes: true,
        paidAt: true,
      },
      orderBy: { paidAt: 'asc' },
    });
    const entries: StatementEntry[] = [];
    for (const purchase of purchases) {
      const itemMap = new Map(purchase.items.map((item) => [item.id, item]));
      const orderedBase = purchase.items.reduce(
        (sum, item) => sum.add(item.unitCost.mul(item.quantity)),
        new Prisma.Decimal(0),
      );
      let receivedWeight = new Prisma.Decimal(0);
      let accruedTransport = new Prisma.Decimal(0);
      for (const receipt of [...purchase.receipts].sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
      )) {
        let base = new Prisma.Decimal(0);
        let tax = new Prisma.Decimal(0);
        let weight = new Prisma.Decimal(0);
        for (const line of receipt.items) {
          const item = itemMap.get(line.purchaseItemId);
          if (!item) continue;
          const amount = line.unitCost.mul(line.quantity);
          base = base.add(amount);
          tax = tax.add(amount.mul(item.taxRate).div(100).toDecimalPlaces(2));
          weight = weight.add(item.unitCost.mul(line.quantity));
        }
        receivedWeight = receivedWeight.add(weight);
        const nextTransport = orderedBase.isZero()
          ? accruedTransport
          : purchase.transportCost.mul(receivedWeight).div(orderedBase).toDecimalPlaces(2);
        const transport = nextTransport.sub(accruedTransport);
        accruedTransport = nextTransport;
        entries.push({
          id: receipt.id,
          date: receipt.receivedAt,
          type: 'PURCHASE_RECEIPT',
          reference: receipt.receiptNumber,
          purchaseId: purchase.id,
          purchaseNumber: purchase.purchaseNumber,
          currency: purchase.currency,
          debit: base.add(tax).add(transport).toFixed(2),
          credit: '0.00',
        });
      }
      let returnedWeight = new Prisma.Decimal(0);
      let creditedTransport = new Prisma.Decimal(0);
      for (const returnRecord of [...purchase.returns].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )) {
        let base = new Prisma.Decimal(0);
        let tax = new Prisma.Decimal(0);
        let weight = new Prisma.Decimal(0);
        for (const line of returnRecord.items) {
          const item = itemMap.get(line.purchaseItemId);
          if (!item) continue;
          const amount = line.unitCost.mul(line.quantity);
          base = base.add(amount);
          tax = tax.add(amount.mul(item.taxRate).div(100).toDecimalPlaces(2));
          weight = weight.add(item.unitCost.mul(line.quantity));
        }
        returnedWeight = returnedWeight.add(weight);
        const nextTransport = orderedBase.isZero()
          ? creditedTransport
          : purchase.transportCost.mul(returnedWeight).div(orderedBase).toDecimalPlaces(2);
        const transport = nextTransport.sub(creditedTransport);
        creditedTransport = nextTransport;
        entries.push({
          id: returnRecord.supplierReturn?.id ?? returnRecord.id,
          date: returnRecord.supplierReturn?.returnedAt ?? returnRecord.createdAt,
          type: 'PURCHASE_RETURN',
          reference: returnRecord.supplierReturn?.returnNumber ?? returnRecord.returnNumber,
          purchaseId: purchase.id,
          purchaseNumber: purchase.purchaseNumber,
          currency: purchase.currency,
          debit: '0.00',
          credit: (returnRecord.supplierReturn?.creditAmount ?? base.add(tax).add(transport)).toFixed(
            2,
          ),
        });
      }
      for (const payment of purchase.payments) {
        entries.push({
          id: payment.id,
          date: payment.paidAt,
          type: 'PURCHASE_PAYMENT',
          reference: payment.reference ?? payment.id,
          purchaseId: purchase.id,
          purchaseNumber: purchase.purchaseNumber,
          currency: purchase.currency,
          debit: '0.00',
          credit: payment.amount.toFixed(2),
          method: payment.method,
        });
      }
    }
    for (const payment of supplierPayments) {
      entries.push({
        id: payment.id,
        date: payment.paidAt,
        type: 'SUPPLIER_PAYMENT',
        reference: payment.reference ?? payment.id,
        currency: payment.currency,
        debit: '0.00',
        credit: payment.amount.toFixed(2),
        method: payment.method,
        notes: payment.notes,
      });
    }
    entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
    const currency = query.currency?.toUpperCase();
    const fromDate = query.from ? new Date(query.from) : undefined;
    const toDate = query.to
      ? /^\d{4}-\d{2}-\d{2}$/.test(query.to)
        ? new Date(`${query.to}T23:59:59.999Z`)
        : new Date(query.to)
      : undefined;
    const relevant = entries.filter((entry) => {
      if (currency && entry.currency !== currency) return false;
      if (fromDate && entry.date < fromDate) return false;
      if (toDate && entry.date > toDate) return false;
      return true;
    });
    const openingEntries = entries.filter(
      (entry) => (!currency || entry.currency === currency) && fromDate && entry.date < fromDate,
    );
    const openingBalances = this.statementTotals(openingEntries);
    const closingBalances = this.statementTotals([...openingEntries, ...relevant]);
    const balances = await this.purchases.getSupplierBalances(
      context.tenantId,
      supplierId,
      supplier.defaultCurrency,
    );
    return {
      supplier: { id: supplier.id, name: supplier.name, defaultCurrency: supplier.defaultCurrency },
      from: query.from ?? null,
      to: query.to ?? null,
      entries: relevant,
      openingBalances,
      closingBalances,
      currentBalances: balances.outstandingBalances,
    };
  }

  async products(userId: string, supplierId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'read',
    });
    await this.findSupplier(context.tenantId, supplierId);
    const [products, prices] = await Promise.all([
      this.database.client.product.findMany({
        where: {
          tenantId: context.tenantId,
          OR: [
            {
              supplierId,
              ...(context.branchId ? { OR: [{ branchId: null }, { branchId: context.branchId }] } : {}),
            },
            {
              supplierPrices: {
                some: {
                  tenantId: context.tenantId,
                  supplierId,
                  product: context.branchId
                    ? { OR: [{ branchId: null }, { branchId: context.branchId }] }
                    : {},
                },
              },
            },
          ],
        },
        select: { id: true, name: true, sku: true, unit: true, status: true },
        orderBy: { name: 'asc' },
      }),
      this.database.client.supplierProductPrice.findMany({
        where: {
          tenantId: context.tenantId,
          supplierId,
          ...(context.branchId && {
            product: { OR: [{ branchId: null }, { branchId: context.branchId }] },
          }),
        },
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
        take: 1000,
      }),
    ]);
    const pricesByProduct = new Map<string, typeof prices>();
    for (const price of prices) {
      const current = pricesByProduct.get(price.productId) ?? [];
      current.push(price);
      pricesByProduct.set(price.productId, current);
    }
    return products.map((product) => ({
      product,
      prices: pricesByProduct.get(product.id) ?? [],
    }));
  }

  async setProductPrice(
    userId: string,
    supplierId: string,
    productId: string,
    dto: SupplierProductPriceDto,
  ) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'update',
    });
    const supplier = await this.findSupplier(context.tenantId, supplierId);
    if (!supplier.isActive || supplier.status !== RecordStatus.ACTIVE) {
      throw new ConflictException('Prices cannot be changed for an inactive supplier.');
    }
    const product = await this.database.client.product.findFirst({
      where: {
        id: productId,
        tenantId: context.tenantId,
        ...(context.branchId && { OR: [{ branchId: null }, { branchId: context.branchId }] }),
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    const price = await this.database.client.$transaction(async (tx) => {
      const created = await tx.supplierProductPrice.create({
        data: {
          tenantId: context.tenantId,
          supplierId,
          productId,
          currency: dto.currency.toUpperCase(),
          unitCost: new Prisma.Decimal(dto.unitCost),
          minimumOrderQty: dto.minimumOrderQty ?? 1,
          ...(dto.leadTimeDays !== undefined && { leadTimeDays: dto.leadTimeDays }),
          ...(dto.effectiveAt && { effectiveAt: new Date(dto.effectiveAt) }),
          notes: dto.notes?.trim() || null,
        },
      });
      await this.audit(
        tx,
        context.tenantId,
        context.branchId,
        userId,
        'SHOP_SUPPLIER_PRICE_RECORDED',
        supplierId,
        {
          productId,
          priceId: created.id,
          amount: created.unitCost.toString(),
          currency: created.currency,
        },
      );
      return created;
    });
    return price;
  }

  async export(userId: string, query: SupplierListQueryDto, format: 'csv' | 'xlsx') {
    const suppliers = await this.list(userId, {
      ...query,
      status: query.status ?? RecordStatus.ACTIVE,
    });
    const columns = [
      'name',
      'legalName',
      'contactName',
      'phone',
      'email',
      'registrationNumber',
      'taxId',
      'address',
      'city',
      'county',
      'country',
      'postalCode',
      'website',
      'paymentTermsDays',
      'creditLimit',
      'defaultCurrency',
      'status',
      'notes',
    ];
    const records = suppliers.map((supplier) =>
      columns.map((field) => this.csvCell((supplier as unknown as Record<string, unknown>)[field])),
    );
    if (format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        extension: 'csv',
        buffer: Buffer.from(
          [
            columns.map((field) => this.csv(field)).join(','),
            ...records.map((row) => row.map((value) => this.csv(value)).join(',')),
          ].join('\r\n'),
          'utf8',
        ),
      };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Suppliers');
    sheet.addRow(columns);
    for (const row of records) sheet.addRow(row);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  async import(userId: string, file: UploadedSupplierFile) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'shop',
      action: 'create',
    });
    const rows = await this.readImportRows(file);
    if (rows.length === 0)
      throw new BadRequestException('The import file contains no supplier rows.');
    if (rows.length > 500)
      throw new BadRequestException('Import a maximum of 500 suppliers at a time.');
    const results: Array<{
      row: number;
      status: 'created' | 'error';
      id?: string;
      message?: string;
    }> = [];
    for (const [index, values] of rows.entries()) {
      const dto = plainToInstance(CreateSupplierProfileDto, this.mapImportRow(values));
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length) {
        results.push({
          row: index + 2,
          status: 'error',
          message: errors.flatMap((error) => Object.values(error.constraints ?? {})).join('; '),
        });
        continue;
      }
      try {
        const supplier = await this.database.client.$transaction(async (tx) => {
          const created = await tx.supplier.create({
            data: {
              tenantId: context.tenantId,
              ...this.profileData(dto),
            },
          });
          await this.audit(
            tx,
            context.tenantId,
            context.branchId,
            userId,
            'SHOP_SUPPLIER_IMPORTED',
            created.id,
            { row: index + 2 },
          );
          return created;
        });
        results.push({ row: index + 2, status: 'created', id: supplier.id });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          results.push({
            row: index + 2,
            status: 'error',
            message: 'A supplier with this name already exists.',
          });
        } else {
          throw error;
        }
      }
    }
    return {
      imported: results.filter((row) => row.status === 'created').length,
      failed: results.filter((row) => row.status === 'error').length,
      rows: results,
    };
  }

  private async findSupplier(tenantId: string, supplierId: string) {
    const supplier = await this.database.client.supplier.findFirst({
      where: { id: supplierId, tenantId },
      include: SUPPLIER_INCLUDE,
    });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    return supplier;
  }

  private async lockSupplier(tx: Prisma.TransactionClient, tenantId: string, supplierId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: RecordStatus; isActive: boolean; defaultCurrency: string }>
    >`
      SELECT "id", "status", "isActive", "defaultCurrency"
      FROM "suppliers"
      WHERE "id" = ${supplierId}::uuid AND "tenantId" = ${tenantId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('Supplier not found.');
    return rows[0]!;
  }

  private profileData(dto: CreateSupplierProfileDto) {
    return {
      name: dto.name.trim(),
      contactName: dto.contactName?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim() || null,
      legalName: dto.legalName?.trim() || null,
      registrationNumber: dto.registrationNumber?.trim() || null,
      taxId: dto.taxId?.trim() || null,
      address: dto.address?.trim() || null,
      city: dto.city?.trim() || null,
      county: dto.county?.trim() || null,
      country: dto.country?.trim() || null,
      postalCode: dto.postalCode?.trim() || null,
      website: dto.website?.trim() || null,
      notes: dto.notes?.trim() || null,
      paymentTermsDays: dto.paymentTermsDays ?? 0,
      creditLimit: new Prisma.Decimal(dto.creditLimit ?? 0),
      defaultCurrency: (dto.defaultCurrency ?? 'KES').toUpperCase(),
      status: dto.status ?? RecordStatus.ACTIVE,
      isActive: (dto.status ?? RecordStatus.ACTIVE) === RecordStatus.ACTIVE,
    };
  }

  private contactData(
    contact: NonNullable<CreateSupplierProfileDto['contacts']>[number],
    tenantId: string,
  ) {
    return {
      tenantId,
      name: contact.name.trim(),
      role: contact.role?.trim() || null,
      phone: contact.phone?.trim() || null,
      email: contact.email?.trim() || null,
      isPrimary: contact.isPrimary ?? false,
      notes: contact.notes?.trim() || null,
    };
  }

  private assertOnePrimaryContact(contacts: Array<{ name: string; isPrimary?: boolean }>) {
    if (contacts.some((contact) => !contact.name.trim())) {
      throw new BadRequestException('Supplier contact names cannot be blank.');
    }
    if (contacts.filter((contact) => contact.isPrimary).length > 1) {
      throw new BadRequestException('Only one supplier contact may be marked primary.');
    }
  }

  private clean(value: string | null | undefined) {
    return value?.trim() || null;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    userId: string,
    action: string,
    supplierId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId,
        branchId,
        actorUserId: userId,
        action,
        resourceType: 'SHOP_SUPPLIER',
        resourceId: supplierId,
        outcome: 'SUCCESS',
        ...(metadata && { metadata }),
      },
    });
  }

  private throwConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A supplier with this name already exists.');
    }
    throw error;
  }

  private async readImportRows(file: UploadedSupplierFile) {
    if (
      !file ||
      !file.buffer.length ||
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
      const buffer = new ArrayBuffer(file.buffer.byteLength);
      new Uint8Array(buffer).set(file.buffer);
      await workbook.xlsx.load(buffer);
    } else {
      throw new BadRequestException('Only CSV and .xlsx supplier files are supported.');
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
      names.forEach((name, index) => {
        if (name) record[name] = this.cellText(values[index]);
      });
      if (Object.values(record).some((value) => value.trim())) rows.push(record);
    });
    return rows;
  }

  private mapImportRow(row: Record<string, string>) {
    const fields: Record<string, string> = {
      name: 'name',
      legalname: 'legalName',
      contactname: 'contactName',
      phone: 'phone',
      email: 'email',
      registrationnumber: 'registrationNumber',
      taxid: 'taxId',
      address: 'address',
      city: 'city',
      county: 'county',
      country: 'country',
      postalcode: 'postalCode',
      website: 'website',
      notes: 'notes',
      paymenttermsdays: 'paymentTermsDays',
      creditlimit: 'creditLimit',
      defaultcurrency: 'defaultCurrency',
      status: 'status',
    };
    const result: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(row)) {
      const key = this.normalize(header);
      const field = fields[key];
      if (!field) {
        result[key] = value;
        continue;
      }
      if (value === '') continue;
      result[field] =
        key === 'paymenttermsdays' || key === 'creditlimit' ? Number(value) : value;
    }
    return result;
  }

  private normalize(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
  }

  private cellText(value: ExcelJS.CellValue | undefined): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object' && 'text' in value) return String(value.text ?? '');
    if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
    return String(value);
  }

  private csvCell(value: unknown) {
    const text = value instanceof Prisma.Decimal ? value.toString() : String(value ?? '');
    return /^[\t\r=+\-@]/.test(text) ? `'${text}` : text;
  }

  private csv(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private statementTotals(entries: Array<{ currency: string; debit: string; credit: string }>) {
    const totals = new Map<string, Prisma.Decimal>();
    for (const entry of entries) {
      const current = totals.get(entry.currency) ?? new Prisma.Decimal(0);
      totals.set(entry.currency, current.add(entry.debit).sub(entry.credit));
    }
    return Object.fromEntries(
      [...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => [currency, amount.toFixed(2)]),
    );
  }
}

type StatementEntry = {
  id: string;
  date: Date;
  type: 'PURCHASE_RECEIPT' | 'PURCHASE_RETURN' | 'PURCHASE_PAYMENT' | 'SUPPLIER_PAYMENT';
  reference: string;
  purchaseId?: string;
  purchaseNumber?: string;
  currency: string;
  debit: string;
  credit: string;
  method?: string;
  notes?: string | null;
};
