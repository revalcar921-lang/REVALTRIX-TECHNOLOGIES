import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { AppointmentsService } from './appointments.service.js';
import { normalizeKenyanPhoneNumber } from './appointment-payment.utils.js';
import type { CreateAppointmentSlotHoldDto, InitiateAppointmentDepositDto } from './dto/create-appointment-slot-hold.dto.js';

interface DarajaConfiguration {
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  callbackToken: string;
}

interface DarajaResponse {
  [key: string]: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

@Injectable()
export class AppointmentPaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentPaymentsService.name);
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly appointments: AppointmentsService,
  ) {}

  onModuleInit(): void {
    this.expiryTimer = setInterval(() => { void this.expirePendingHolds(); }, 30_000);
    this.expiryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  private darajaConfiguration(): DarajaConfiguration {
    const enabled = this.config.get<boolean>('payments.daraja.enabled') === true;
    const settlementApproved = this.config.get<boolean>('payments.daraja.settlementApproved') === true;
    const environment = this.config.get<'sandbox' | 'production'>('payments.daraja.environment') ?? 'sandbox';
    const consumerKey = this.config.get<string>('payments.daraja.consumerKey')?.trim() ?? '';
    const consumerSecret = this.config.get<string>('payments.daraja.consumerSecret')?.trim() ?? '';
    const shortcode = this.config.get<string>('payments.daraja.shortcode')?.trim() ?? '';
    const passkey = this.config.get<string>('payments.daraja.passkey')?.trim() ?? '';
    const callbackUrl = this.config.get<string>('payments.daraja.callbackUrl')?.trim() ?? '';
    const callbackToken = this.config.get<string>('payments.daraja.callbackToken')?.trim() ?? '';
    let validCallback = false;
    try {
      const parsed = new URL(callbackUrl);
      validCallback = parsed.protocol === 'https:' && callbackToken.length >= 32 &&
        decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '') === callbackToken;
    } catch {
      validCallback = false;
    }
    if (!enabled || !settlementApproved || !consumerKey || !consumerSecret || !shortcode || !passkey || !validCallback) {
      throw new ServiceUnavailableException('Online deposits are unavailable until Daraja credentials, an HTTPS callback token, and approved settlement configuration are set up. No payment was initiated.');
    }
    return { environment, consumerKey, consumerSecret, shortcode, passkey, callbackUrl, callbackToken };
  }

  private darajaBaseUrl(environment: DarajaConfiguration['environment']): string {
    return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  }

  private async requestJson(url: string, init: RequestInit): Promise<DarajaResponse> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new ServiceUnavailableException('M-Pesa could not be reached. The payment status must be checked before another request.');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException('M-Pesa returned an unreadable response. The payment status must be reconciled.');
    }
    const result = record(body);
    if (!response.ok || !result) {
      throw new ServiceUnavailableException('M-Pesa did not return a successful API response.');
    }
    return result;
  }

  private async accessToken(config: DarajaConfiguration): Promise<string> {
    const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const response = await this.requestJson(
      `${this.darajaBaseUrl(config.environment)}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );
    const token = text(response.access_token);
    if (!token) throw new ServiceUnavailableException('M-Pesa authentication failed.');
    return token;
  }

  private darajaTimestamp(): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
  }

  private password(config: DarajaConfiguration, timestamp: string): string {
    return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
  }

  private async initiateStkPush(config: DarajaConfiguration, phoneNumber: string, reference: string) {
    const accessToken = await this.accessToken(config);
    const timestamp = this.darajaTimestamp();
    return this.requestJson(`${this.darajaBaseUrl(config.environment)}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: this.password(config, timestamp),
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: 100,
        PartyA: phoneNumber,
        PartyB: config.shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: config.callbackUrl,
        AccountReference: reference.slice(0, 12),
        TransactionDesc: 'APPT DEPOSIT',
      }),
    });
  }

  private async queryStkStatus(config: DarajaConfiguration, checkoutRequestId: string): Promise<DarajaResponse> {
    const accessToken = await this.accessToken(config);
    const timestamp = this.darajaTimestamp();
    return this.requestJson(`${this.darajaBaseUrl(config.environment)}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: this.password(config, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });
  }

  async createSlotHold(userId: string, dto: CreateAppointmentSlotHoldDto) {
    const eligibility = await this.appointments.getPatientBookingEligibility(userId, dto.tenantId);
    if (!eligibility.canBook) {
      throw new ForbiddenException(`You cannot book at this facility yet (${eligibility.reason ?? 'eligibility required'}).`);
    }
    this.darajaConfiguration();
    try { new Intl.DateTimeFormat('en-US', { timeZone: dto.timeZone }).format(new Date(dto.startAt)); }
    catch { throw new BadRequestException('A valid IANA time zone is required.'); }
    const profile = await this.database.client.patientProfile.findUnique({ where: { userId }, select: { id: true } });
    const patient = profile ? await this.database.client.patientTenantRecord.findFirst({
      where: { tenantId: dto.tenantId, patientProfileId: profile.id, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    }) : null;
    if (!patient) throw new ForbiddenException('Active facility registration is required before reserving a slot.');

    const existing = await this.database.client.appointmentSlotHold.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true, patientTenantRecordId: true, status: true, expiresAt: true },
    });
    if (existing) {
      if (existing.patientTenantRecordId !== patient.id) throw new ConflictException('This request key has already been used.');
      if (existing.status === 'ACTIVE' && existing.expiresAt > new Date()) return { id: existing.id, expiresAt: existing.expiresAt, status: existing.status };
      throw new ConflictException('This slot hold request has already expired or been used. Refresh availability and try again.');
    }

    const available = await this.appointments.discoverSlots({
      tenantId: dto.tenantId,
      serviceId: dto.serviceId,
      providerId: dto.providerId,
      branchId: dto.branchId,
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      from: dto.startAt,
      to: dto.endAt,
    });
    const slotExists = available.some((slot) => slot.startAt === new Date(dto.startAt).toISOString() && slot.endAt === new Date(dto.endAt).toISOString());
    if (!slotExists) throw new ConflictException('That time is no longer available. Refresh and choose another slot.');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    try {
      const hold = await this.database.client.$transaction(async (tx) => {
        await tx.appointmentSlotHold.updateMany({
          where: { tenantId: dto.tenantId, providerId: dto.providerId, status: 'ACTIVE', expiresAt: { lte: now }, startAt: { lt: new Date(dto.endAt) }, endAt: { gt: new Date(dto.startAt) } },
          data: { status: 'EXPIRED' },
        });
        const overlappingAppointment = await tx.appointment.findFirst({
          where: {
            tenantId: dto.tenantId,
            status: { notIn: ['CANCELLED', 'REJECTED', 'COMPLETED', 'NO_SHOW'] },
            providerId: dto.providerId,
            startAt: { lt: new Date(dto.endAt) },
            endAt: { gt: new Date(dto.startAt) },
          },
          select: { id: true },
        });
        const overlappingHold = await tx.appointmentSlotHold.findFirst({
          where: {
            tenantId: dto.tenantId,
            providerId: dto.providerId,
            status: 'ACTIVE',
            expiresAt: { gt: now },
            startAt: { lt: new Date(dto.endAt) },
            endAt: { gt: new Date(dto.startAt) },
          },
          select: { id: true },
        });
        if (overlappingAppointment || overlappingHold) {
          throw new ConflictException('Another appointment or active hold overlaps this time. Refresh availability.');
        }
        const created = await tx.appointmentSlotHold.create({
          data: {
            tenantId: dto.tenantId,
            patientTenantRecordId: patient.id,
            providerId: dto.providerId,
            branchId: dto.branchId,
            departmentId: dto.departmentId ?? null,
            serviceId: dto.serviceId,
            startAt: new Date(dto.startAt),
            endAt: new Date(dto.endAt),
            timeZone: dto.timeZone,
            reason: dto.reason?.trim() || null,
            idempotencyKey: dto.idempotencyKey,
            expiresAt,
          },
          select: { id: true, expiresAt: true, status: true },
        });
        await tx.auditEvent.create({
          data: { tenantId: dto.tenantId, actorUserId: userId, branchId: dto.branchId, action: 'APPOINTMENT_SLOT_HELD', resourceType: 'APPOINTMENT_SLOT_HOLD', resourceId: created.id, outcome: 'SUCCESS', metadata: { providerId: dto.providerId, serviceId: dto.serviceId, expiresAt: expiresAt.toISOString() } },
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000, maxWait: 10000 });
      return hold;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new ConflictException('Another patient has temporarily reserved that time. Refresh availability.');
      }
      throw error;
    }
  }

  async initiateDeposit(userId: string, holdId: string, dto: InitiateAppointmentDepositDto) {
    const config = this.darajaConfiguration();
    const phoneNumber = normalizeKenyanPhoneNumber(dto.phoneNumber);
    const hold = await this.database.client.appointmentSlotHold.findFirst({
      where: { id: holdId, status: 'ACTIVE', expiresAt: { gt: new Date() }, patient: { is: { patientProfile: { is: { userId } } } } },
      select: { id: true, tenantId: true, patientTenantRecordId: true, expiresAt: true },
    });
    if (!hold) throw new NotFoundException('Active slot hold not found. Search for another time.');
    const pendingIntent = await this.database.client.appointmentPaymentIntent.findFirst({
      where: { slotHoldId: hold.id, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED', 'SUCCEEDED'] } },
      select: { id: true, status: true },
    });
    if (pendingIntent) {
      throw new ConflictException(pendingIntent.status === 'SUCCEEDED'
        ? 'This slot already has a confirmed deposit.'
        : 'A payment request is already pending or requires reconciliation. Do not send another M-Pesa prompt.');
    }
    const existing = await this.database.client.appointmentPaymentIntent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true, slotHoldId: true, phoneNumber: true, status: true, expiresAt: true, internalReference: true },
    });
    if (existing) {
      if (existing.slotHoldId !== hold.id || existing.phoneNumber !== phoneNumber) throw new ConflictException('This payment request key has already been used.');
      return { paymentIntentId: existing.id, reference: existing.internalReference, status: existing.status, expiresAt: existing.expiresAt };
    }

    const internalReference = `AP${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const intent = await this.database.client.appointmentPaymentIntent.create({
      data: {
        tenantId: hold.tenantId,
        patientTenantRecordId: hold.patientTenantRecordId,
        slotHoldId: hold.id,
        internalReference,
        idempotencyKey: dto.idempotencyKey,
        phoneNumber,
        amount: new Prisma.Decimal(100),
        currency: 'KES',
        expiresAt: hold.expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    let response: DarajaResponse;
    try {
      response = await this.initiateStkPush(config, phoneNumber, internalReference);
    } catch (error) {
      await this.database.client.appointmentPaymentIntent.update({
        where: { id: intent.id },
        data: { status: 'RECONCILIATION_REQUIRED', providerResultText: 'STK request outcome is unknown; reconciliation required.' },
      });
      throw error;
    }
    const responseCode = text(response.ResponseCode);
    const checkoutRequestId = text(response.CheckoutRequestID);
    const merchantRequestId = text(response.MerchantRequestID);
    if (responseCode !== '0' || !checkoutRequestId || !merchantRequestId) {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentPaymentIntent.update({
          where: { id: intent.id },
          data: { status: 'FAILED', providerResultText: text(response.ResponseDescription) ?? 'Daraja rejected the STK request.' },
        });
        await tx.appointmentSlotHold.updateMany({ where: { id: hold.id, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
      });
      throw new ServiceUnavailableException('M-Pesa could not start this payment. The slot hold was released.');
    }
    await this.database.client.appointmentPaymentIntent.update({
      where: { id: intent.id },
      data: { merchantRequestId, checkoutRequestId, providerResultText: text(response.ResponseDescription) },
    });
    await this.database.client.auditEvent.create({
      data: { tenantId: hold.tenantId, actorUserId: userId, action: 'APPOINTMENT_DEPOSIT_STK_INITIATED', resourceType: 'APPOINTMENT_PAYMENT_INTENT', resourceId: intent.id, outcome: 'SUCCESS', metadata: { reference: internalReference, amount: '100.00', currency: 'KES' } },
    });
    return { paymentIntentId: intent.id, reference: internalReference, status: 'PENDING' as const, expiresAt: intent.expiresAt };
  }

  async getPaymentStatus(userId: string, paymentIntentId: string) {
    const intent = await this.database.client.appointmentPaymentIntent.findFirst({
      where: { id: paymentIntentId, patient: { is: { patientProfile: { is: { userId } } } } },
      select: { id: true, internalReference: true, amount: true, currency: true, status: true, providerReceipt: true, paidAt: true, expiresAt: true, appointment: { select: { id: true, appointmentNumber: true, status: true } } },
    });
    if (!intent) throw new NotFoundException('Payment request not found.');
    return intent;
  }

  async handleDarajaCallback(token: string, payload: unknown) {
    const config = this.darajaConfiguration();
    const supplied = Buffer.from(token);
    const expected = Buffer.from(config.callbackToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ForbiddenException('Callback authentication failed.');
    }
    const root = record(payload);
    const callbackBody = record(root?.Body);
    const callback = record(callbackBody?.stkCallback);
    if (!callback) throw new BadRequestException('Invalid M-Pesa callback payload.');
    const checkoutRequestId = text(callback.CheckoutRequestID);
    const merchantRequestId = text(callback.MerchantRequestID);
    const callbackResultCode = integer(callback.ResultCode);
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const eventKey = `daraja:${checkoutRequestId ?? 'unknown'}:${payloadHash}`;
    const intent = checkoutRequestId ? await this.database.client.appointmentPaymentIntent.findFirst({
      where: { checkoutRequestId },
      select: { id: true, tenantId: true, patientTenantRecordId: true, status: true, merchantRequestId: true, phoneNumber: true, amount: true, currency: true, slotHoldId: true },
    }) : null;
    let eventId: string;
    try {
      const event = await this.database.client.appointmentPaymentEvent.create({
        data: {
          paymentIntentId: intent?.id ?? null,
          eventKey,
          checkoutRequestId,
          resultCode: callbackResultCode,
          resultText: text(callback.ResultDesc),
          status: intent ? 'RECEIVED' : 'UNMATCHED',
          payloadHash,
        },
        select: { id: true },
      });
      eventId = event.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { accepted: true, duplicate: true };
      throw error;
    }
    if (!intent || !checkoutRequestId || intent.status === 'SUCCEEDED') {
      return { accepted: true, duplicate: intent?.status === 'SUCCEEDED' };
    }
    if (merchantRequestId !== intent.merchantRequestId) {
      await this.database.client.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'REJECTED', failureReason: 'Merchant request identifier mismatch.' } });
      return { accepted: true, reconciliationRequired: true };
    }

    let statusQuery: DarajaResponse;
    try {
      statusQuery = await this.queryStkStatus(config, checkoutRequestId);
    } catch {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentPaymentIntent.updateMany({ where: { id: intent.id, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] } }, data: { status: 'RECONCILIATION_REQUIRED' } });
        await tx.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'RECONCILIATION_REQUIRED', failureReason: 'Authoritative Daraja transaction query was unavailable.' } });
      });
      return { accepted: true, reconciliationRequired: true };
    }

    const queriedResultCode = integer(statusQuery.ResultCode);
    const responseCode = text(statusQuery.ResponseCode);
    if (queriedResultCode === null && responseCode === '0') {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentPaymentIntent.updateMany({ where: { id: intent.id, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] } }, data: { status: 'RECONCILIATION_REQUIRED' } });
        await tx.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'RECONCILIATION_REQUIRED', failureReason: 'Daraja query acknowledged but did not provide a final transaction result.' } });
      });
      return { accepted: true, reconciliationRequired: true };
    }
    if (queriedResultCode !== 0) {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentPaymentIntent.updateMany({ where: { id: intent.id, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] } }, data: { status: 'FAILED', providerResultCode: queriedResultCode, providerResultText: text(statusQuery.ResultDesc) ?? text(callback.ResultDesc) } });
        await tx.appointmentSlotHold.updateMany({ where: { id: intent.slotHoldId, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
        await tx.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', resultCode: queriedResultCode, resultText: text(statusQuery.ResultDesc) ?? text(callback.ResultDesc) } });
      });
      return { accepted: true, status: 'FAILED' as const };
    }

    const metadata = record(callback.CallbackMetadata);
    const items = Array.isArray(metadata?.Item) ? metadata.Item.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
    const metadataValue = (name: string) => items.find((item) => item.Name === name)?.Value;
    const amount = Number(metadataValue('Amount'));
    const receipt = text(metadataValue('MpesaReceiptNumber'));
    let phoneNumber: string | null = null;
    try { phoneNumber = normalizeKenyanPhoneNumber(String(metadataValue('PhoneNumber') ?? '')); } catch { phoneNumber = null; }
    if (callbackResultCode !== 0 || amount !== intent.amount.toNumber() || intent.currency !== 'KES' || !receipt || phoneNumber !== intent.phoneNumber) {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentPaymentIntent.updateMany({ where: { id: intent.id, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] } }, data: { status: 'RECONCILIATION_REQUIRED' } });
        await tx.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'REJECTED', amount: Number.isFinite(amount) ? new Prisma.Decimal(amount) : null, receipt, failureReason: 'Callback amount, currency, phone, result, or receipt did not match the payment intent.' } });
      });
      return { accepted: true, reconciliationRequired: true };
    }

    try {
      const paymentPatient = await this.database.client.patientTenantRecord.findUnique({
        where: { id: intent.patientTenantRecordId },
        select: { patientProfile: { select: { userId: true } } },
      });
      if (!paymentPatient) throw new NotFoundException('Payment patient record not found.');
      await this.appointments.finalizePaidBooking(paymentPatient.patientProfile.userId, intent.id, receipt);
    } catch {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentPaymentIntent.updateMany({ where: { id: intent.id, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] } }, data: { status: 'RECONCILIATION_REQUIRED', providerReceipt: receipt, providerResultCode: 0, providerResultText: 'Payment verified by Daraja; appointment finalization requires reconciliation.' } });
        await tx.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'RECONCILIATION_REQUIRED', amount: new Prisma.Decimal(amount), receipt, failureReason: 'Verified payment could not atomically finalize the slot booking.' } });
      });
      return { accepted: true, reconciliationRequired: true };
    }
    await this.database.client.appointmentPaymentEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', amount: new Prisma.Decimal(amount), receipt, resultCode: 0, resultText: text(statusQuery.ResultDesc), processedAt: new Date() } });
    return { accepted: true, status: 'SUCCEEDED' as const };
  }

  private async expirePendingHolds(): Promise<void> {
    const now = new Date();
    try {
      await this.database.client.$transaction(async (tx) => {
        await tx.appointmentSlotHold.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
        await tx.appointmentPaymentIntent.updateMany({
          where: { status: 'PENDING', expiresAt: { lte: now }, checkoutRequestId: null },
          data: { status: 'EXPIRED' },
        });
        await tx.appointmentPaymentIntent.updateMany({
          where: { status: 'PENDING', expiresAt: { lte: now }, checkoutRequestId: { not: null } },
          data: { status: 'RECONCILIATION_REQUIRED', providerResultText: 'Payment window expired before a final verified callback.' },
        });
      });
    } catch (error) {
      this.logger.error('Appointment payment expiry pass failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}