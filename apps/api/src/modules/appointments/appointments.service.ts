import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentBookingSource,
  AppointmentStatus,
  NotificationChannel,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { CreateRecurringAppointmentDto } from './dto/create-recurring-appointment.dto.js';
import { CreatePatientAppointmentDto } from './dto/create-patient-appointment.dto.js';
import { AppointmentQueryDto } from './dto/appointment-query.dto.js';
import { AppointmentSlotsQueryDto } from './dto/appointment-slots-query.dto.js';
import { TransitionAppointmentDto } from './dto/transition-appointment.dto.js';
import type { RequestAppointmentRefundDto, ReviewAppointmentRefundDto } from './dto/appointment-refund.dto.js';
import { EncountersService } from '../encounters/encounters.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { parseTenantWebsiteContent } from '../tenant-websites/tenant-website.utils.js';

const TERMINAL_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.REJECTED,
];

const TRANSITIONS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  [AppointmentStatus.REQUESTED]: [
    AppointmentStatus.PENDING_APPROVAL,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.REJECTED,
  ],
  [AppointmentStatus.PENDING_APPROVAL]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.REJECTED,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.CHECKED_IN]: [
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.IN_PROGRESS]: [
    AppointmentStatus.COMPLETED,
  ],
};

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly encounters: EncountersService,
    private readonly notifications: NotificationsService,
  ) {}

  private async notifyAppointmentParticipants(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      patientUserId: string;
      appointmentId: string;
      appointmentNumber: string;
      status: AppointmentStatus;
      eventKey: string;
      branchId: string | null;
      departmentId: string | null;
      tenantName: string;
    },
  ) {
    const memberships = await tx.membership.findMany({
      where: {
        tenantId: input.tenantId,
        status: 'ACTIVE',
        startsAt: { lte: new Date() },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        AND: [
          { OR: [{ branchId: null }, ...(input.branchId ? [{ branchId: input.branchId }] : [])] },
          { OR: [{ departmentId: null }, ...(input.departmentId ? [{ departmentId: input.departmentId }] : [])] },
        ],
        roles: {
          some: {
            role: {
              status: 'ACTIVE',
              permissions: {
                some: {
                  permission: {
                    scope: 'TENANT',
                    status: 'ACTIVE',
                    effect: 'ALLOW',
                    resource: 'appointments',
                    action: { in: ['read', 'create', 'update'] },
                  },
                },
              },
            },
          },
        },
        NOT: {
          roles: {
            some: {
              role: {
                permissions: {
                  some: {
                    permission: {
                      scope: 'TENANT',
                      status: 'ACTIVE',
                      effect: 'DENY',
                      resource: 'appointments',
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: { userId: true },
    });
    const recipients = [...new Set([input.patientUserId, ...memberships.map(({ userId }) => userId)])];
    const patientBody = input.status === AppointmentStatus.REQUESTED
      ? `Your appointment request ${input.appointmentNumber} was received by ${input.tenantName}.`
      : `Appointment ${input.appointmentNumber} at ${input.tenantName} is now ${input.status.replaceAll('_', ' ').toLowerCase()}.`;
    const staffBody = input.status === AppointmentStatus.REQUESTED
      ? `A new patient portal appointment request (${input.appointmentNumber}) needs review.`
      : `Appointment ${input.appointmentNumber} status changed to ${input.status.replaceAll('_', ' ').toLowerCase()}.`;
    await Promise.all(recipients.map((recipientUserId) => {
      const isPatient = recipientUserId === input.patientUserId;
      return this.notifications.createNotificationInTransaction(tx, {
        tenantId: input.tenantId,
        recipientUserId,
        type: `APPOINTMENT_${input.status}`,
        title: isPatient ? 'Appointment update' : 'Appointment activity',
        body: isPatient ? patientBody : staffBody,
        data: { appointmentId: input.appointmentId, appointmentNumber: input.appointmentNumber, status: input.status },
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        idempotencyPrefix: input.eventKey,
      });
    }));
  }

  async discoverFacilities(query?: { search?: string }) {
    const search = query?.search?.trim();
    const facilities = await this.database.client.tenant.findMany({
      where: {
        status: RecordStatus.ACTIVE,
        deletedAt: null,
        setup: { is: { status: 'LIVE' } },
        website: { is: { status: 'PUBLISHED' } },
        bookingPolicy: { is: { allowOnlineBooking: true } },
        services: {
          some: {
            status: RecordStatus.ACTIVE,
            deletedAt: null,
          },
        },
        ...(search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { legalName: { contains: search, mode: 'insensitive' } },
            { profile: { is: { businessName: { contains: search, mode: 'insensitive' } } } },
            { branches: { some: { status: RecordStatus.ACTIVE, deletedAt: null, OR: [
              { address: { contains: search, mode: 'insensitive' } },
              { town: { contains: search, mode: 'insensitive' } },
              { county: { contains: search, mode: 'insensitive' } },
            ] } } },
            { services: { some: { status: RecordStatus.ACTIVE, deletedAt: null, OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { category: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ] } } },
          ],
        } : {}),
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        type: true,
        profile: {
          select: {
            businessName: true,
            country: true,
            county: true,
            subcounty: true,
            address: true,
            description: true,
            contactPhone: true,
          },
        },
        website: {
          select: {
            publishedContent: true,
          },
        },
        branches: {
          where: { status: RecordStatus.ACTIVE, deletedAt: null },
          select: {
            id: true,
            name: true,
            address: true,
            town: true,
            county: true,
            postalCode: true,
            latitude: true,
            longitude: true,
            contactPhone: true,
            openingTime: true,
            closingTime: true,
            operatingDays: true,
          },
          orderBy: { name: 'asc' },
        },
        departments: {
          where: { status: RecordStatus.ACTIVE, deletedAt: null },
          select: { id: true, name: true, branchId: true },
          orderBy: { name: 'asc' },
        },
        services: {
          where: { status: RecordStatus.ACTIVE, deletedAt: null },
          select: {
            id: true,
            name: true,
            code: true,
            description: true,
            category: true,
            durationMin: true,
            branchId: true,
            departmentId: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return facilities.flatMap(({ website, ...facility }) => {
      if (!website?.publishedContent) return [];
      const publicContent = parseTenantWebsiteContent(
        website.publishedContent,
        facility.name,
      );
      const publicBranchIds = new Set(publicContent.branchIds);
      const publicServiceIds = new Set(publicContent.serviceIds);
      const branches = facility.branches.filter((branch) =>
        publicBranchIds.has(branch.id),
      );
      if (!branches.length) return [];

      const services = facility.services.filter((service) =>
        publicServiceIds.has(service.id) &&
        (!service.branchId || publicBranchIds.has(service.branchId)),
      );
      if (!services.length) return [];
      const serviceDepartmentIds = new Set(
        services.flatMap((service) => service.departmentId ? [service.departmentId] : []),
      );
      const departments = facility.departments.filter((department) =>
        (!department.branchId || publicBranchIds.has(department.branchId)) &&
        (serviceDepartmentIds.has(department.id) ||
          services.some((service) => !service.departmentId)),
      );
      return [{ ...facility, branches, departments, services }];
    });
  }

  async discoverSlots(query: AppointmentSlotsQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const now = new Date();

    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      to <= from
    ) {
      throw new BadRequestException('A valid increasing date range is required');
    }

    if (to.getTime() - from.getTime() > 14 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Search no more than 14 days at a time');
    }

    const db = this.database.client;
    const publicContent = await this.getPublicBookingContent(query.tenantId);
    if (!publicContent) {
      throw new NotFoundException('This facility is not accepting public online appointments');
    }
    if (!publicContent.serviceIds.includes(query.serviceId)) {
      throw new NotFoundException('This service is not offered for public appointments');
    }
    if (query.branchId && !publicContent.branchIds.includes(query.branchId)) {
      throw new NotFoundException('This branch is not offered for public appointments');
    }
    const service = await db.service.findFirst({
      where: {
        id: query.serviceId,
        tenantId: query.tenantId,
        status: RecordStatus.ACTIVE,
        deletedAt: null,
        tenant: {
          is: {
            status: RecordStatus.ACTIVE,
            deletedAt: null,
            setup: { is: { status: 'LIVE' } },
          },
        },
        AND: [
          ...(query.branchId ? [{ OR: [{ branchId: null }, { branchId: query.branchId }] }] : []),
          ...(!query.branchId ? [{ OR: [{ branchId: null }, { branchId: { in: publicContent.branchIds } }] }] : []),
          ...(query.departmentId ? [{ OR: [{ departmentId: null }, { departmentId: query.departmentId }] }] : []),
        ],
      },
      select: { id: true, durationMin: true, branchId: true, departmentId: true },
    });

    if (!service) {
      throw new NotFoundException('Bookable service not found at this facility');
    }

    const rules = await db.providerAvailability.findMany({
      where: {
        tenantId: query.tenantId,
        isActive: true,
        ...(query.providerId
          ? { providerId: query.providerId }
          : {}),
        AND: [
          ...(query.branchId ? [{ OR: [{ branchId: null }, { branchId: query.branchId }] }] : []),
          ...(query.departmentId ? [{ OR: [{ departmentId: null }, { departmentId: query.departmentId }] }] : []),
          { OR: [{ serviceId: null }, { serviceId: service.id }] },
        ],
        provider: {
          is: {
            status: RecordStatus.ACTIVE,
            deletedAt: null,
          },
        },
      },
      include: {
        provider: {
          select: {
            id: true,
            professionalTitle: true,
            specialty: true,
          },
        },
      },
    });

    const slots: Array<{
      tenantId: string;
      serviceId: string;
      providerId: string;
      providerTitle: string | null;
      specialty: string | null;
      branchId: string | null;
      departmentId: string | null;
      startAt: string;
      endAt: string;
      timeZone: string;
    }> = [];

    const slotKeys = new Set<string>();

    for (const rule of rules) {
      const duration = service.durationMin ?? rule.slotDurationMin ?? 30;
      if (
        !Number.isInteger(duration) ||
        duration < 5 ||
        duration > 720 ||
        (rule.slotDurationMin != null && rule.slotDurationMin !== duration)
      ) {
        continue;
      }

      const ruleStart = new Date(rule.effectiveFrom);
      const ruleEnd = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
      const firstDay = new Date(Math.max(from.getTime(), now.getTime()));
      firstDay.setUTCHours(0, 0, 0, 0);

      for (
        let day = new Date(firstDay);
        day.getTime() < to.getTime();
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        const dateKey = new Intl.DateTimeFormat('en-CA', {
          timeZone: rule.timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(day);

        const [yearPart, monthPart, datePart] = dateKey.split('-');
        const year = Number(yearPart ?? 0);
        const month = Number(monthPart ?? 0);
        const date = Number(datePart ?? 0);

        if (
          !Number.isInteger(year) ||
          !Number.isInteger(month) ||
          !Number.isInteger(date) ||
          year < 1 ||
          month < 1 ||
          month > 12 ||
          date < 1 ||
          date > 31
        ) {
          continue;
        }

        const localDate = new Date(Date.UTC(year, month - 1, date));
        const weekday = localDate.getUTCDay();
        const effectiveStartKey = `${ruleStart.getUTCFullYear()}-${String(ruleStart.getUTCMonth() + 1).padStart(2, '0')}-${String(ruleStart.getUTCDate()).padStart(2, '0')}`;
        const effectiveEndKey = ruleEnd
          ? `${ruleEnd.getUTCFullYear()}-${String(ruleEnd.getUTCMonth() + 1).padStart(2, '0')}-${String(ruleEnd.getUTCDate()).padStart(2, '0')}`
          : null;

        if (
          weekday !== rule.dayOfWeek ||
          dateKey < effectiveStartKey ||
          (effectiveEndKey !== null && dateKey > effectiveEndKey)
        ) {
          continue;
        }

        // Convert each wall-clock minute to a real instant using the rule's IANA timezone.
        const instantForMinute = (minute: number): Date | null => {
          const target = new Date(localDate);
          target.setUTCHours(0, minute, 0, 0);
          const desired = target.getTime();
          let guess = desired;

          for (let i = 0; i < 4; i++) {
            const parts = new Intl.DateTimeFormat('en-GB', {
              timeZone: rule.timeZone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).formatToParts(new Date(guess));
            const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
            const actual = Date.UTC(
              Number(get('year')),
              Number(get('month')) - 1,
              Number(get('day')),
              Number(get('hour')),
              Number(get('minute')),
            );
            guess += desired - actual;
          }

          const result = new Date(guess);
          const check = new Intl.DateTimeFormat('en-GB', {
            timeZone: rule.timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(result);
          const expected = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
          return check === expected ? result : null;
        };

        for (
          let minute = rule.startMinute;
          minute + duration <= rule.endMinute;
          minute += duration
        ) {
          const startAt = instantForMinute(minute);
          const endAt = instantForMinute(minute + duration);
          if (!startAt || !endAt || startAt < from || endAt > to || startAt <= now || endAt <= startAt) {
            continue;
          }

          const branchId = query.branchId ?? rule.branchId ?? service.branchId;
          const departmentId = query.departmentId ?? rule.departmentId ?? service.departmentId;
          if (!branchId || !publicContent.branchIds.includes(branchId)) continue;
          const conflict = await db.appointment.findFirst({
            where: {
              tenantId: query.tenantId,
              providerId: rule.providerId,
              status: { notIn: TERMINAL_STATUSES },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
            select: { id: true },
          });
          if (conflict) continue;

          const activeHold = await db.appointmentSlotHold.findFirst({
            where: {
              tenantId: query.tenantId,
              providerId: rule.providerId,
              status: 'ACTIVE',
              expiresAt: { gt: now },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
            select: { id: true },
          });
          if (activeHold) continue;

          const block = await db.availabilityBlock.findFirst({
            where: {
              tenantId: query.tenantId,
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              AND: [
                { OR: [{ providerId: null }, { providerId: rule.providerId }] },
                { OR: [{ branchId: null }, { branchId }] },
                { OR: [{ departmentId: null }, { departmentId }] },
                { OR: [{ serviceId: null }, { serviceId: service.id }] },
              ],
            },
            select: { id: true },
          });
          if (block) continue;

          const key = `${branchId}:${departmentId ?? ''}:${startAt.toISOString()}`;
          if (slotKeys.has(key)) continue;
          slotKeys.add(key);

          slots.push({
            tenantId: query.tenantId,
            serviceId: service.id,
            providerId: rule.providerId,
            providerTitle: rule.provider.professionalTitle,
            specialty: rule.provider.specialty,
            branchId,
            departmentId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            timeZone: rule.timeZone,
          });
        }
      }
    }

    return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async assertPublicBookingSelection(
    tenantId: string,
    serviceId: string,
    branchId: string,
  ): Promise<void> {
    const publicContent = await this.getPublicBookingContent(tenantId);
    if (
      !publicContent ||
      !publicContent.serviceIds.includes(serviceId) ||
      !publicContent.branchIds.includes(branchId)
    ) {
      throw new NotFoundException('This branch or service is no longer offered for public appointments');
    }
  }

  private async getPublicBookingContent(tenantId: string) {
    const website = await this.database.client.tenantWebsite.findFirst({
      where: {
        tenantId,
        status: 'PUBLISHED',
        tenant: {
          is: {
            status: RecordStatus.ACTIVE,
            deletedAt: null,
            setup: { is: { status: 'LIVE' } },
            bookingPolicy: { is: { allowOnlineBooking: true } },
          },
        },
      },
      select: {
        publishedContent: true,
        tenant: { select: { name: true } },
      },
    });
    if (!website?.publishedContent) return null;
    return parseTenantWebsiteContent(website.publishedContent, website.tenant.name);
  }

  async getPatientBookingEligibility(userId: string, tenantId: string) {
    const db = this.database.client;
    const [profile, identity, patientRecord, tenant] = await Promise.all([
      db.patientProfile.findUnique({
        where: { userId },
        select: { id: true, user: { select: { status: true, deletedAt: true } } },
      }),
      db.identity.findFirst({
        where: { userId, status: RecordStatus.ACTIVE, verifiedAt: { not: null } },
        select: { id: true },
      }),
      db.patientTenantRecord.findFirst({
        where: { tenantId, patientProfile: { userId }, deletedAt: null },
        select: { status: true },
      }),
      db.tenant.findFirst({
        where: {
          id: tenantId,
          status: RecordStatus.ACTIVE,
          deletedAt: null,
          setup: { is: { status: 'LIVE' } },
          website: { is: { status: 'PUBLISHED' } },
          bookingPolicy: { is: { allowOnlineBooking: true } },
        },
        select: {
          id: true,
          website: { select: { publishedContent: true } },
        },
      }),
    ]);
    const userActive = Boolean(profile && profile.user.status === RecordStatus.ACTIVE && !profile.user.deletedAt);
    const identityVerified = Boolean(identity);
    const facilityRegistrationActive = patientRecord?.status === 'ACTIVE';
    const facilityBookable = Boolean(tenant?.website?.publishedContent);
    const reason = !profile
      ? 'PATIENT_PROFILE_REQUIRED'
      : !userActive
        ? 'ACCOUNT_INACTIVE'
        : !identityVerified
          ? 'IDENTITY_VERIFICATION_REQUIRED'
          : !facilityBookable
            ? 'FACILITY_NOT_BOOKABLE'
            : !facilityRegistrationActive
              ? patientRecord?.status === 'PENDING' ? 'FACILITY_REGISTRATION_PENDING' : 'FACILITY_REGISTRATION_REQUIRED'
              : null;
    return {
      canBook: reason === null,
      identityVerified,
      patientProfileExists: Boolean(profile),
      facilityRegistrationStatus: patientRecord?.status ?? null,
      reason,
    };
  }

  async finalizePaidBooking(userId: string, paymentIntentId: string, providerReceipt: string) {
    const intent = await this.database.client.appointmentPaymentIntent.findFirst({
      where: {
        id: paymentIntentId,
        status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] },
        patient: { is: { patientProfile: { is: { userId } } } },
      },
      select: {
        id: true,
        tenantId: true,
        patientTenantRecordId: true,
        slotHoldId: true,
        amount: true,
        currency: true,
        tenant: { select: { name: true } },
        slotHold: {
          select: {
            status: true,
            expiresAt: true,
            providerId: true,
            branchId: true,
            departmentId: true,
            serviceId: true,
            startAt: true,
            endAt: true,
            timeZone: true,
            reason: true,
          },
        },
      },
    });
    if (!intent) throw new NotFoundException('Pending appointment payment was not found.');
    if (intent.amount.toNumber() !== 100 || intent.currency !== 'KES') {
      throw new ConflictException('Appointment deposit amount or currency is invalid.');
    }
    if (intent.slotHold.status !== 'ACTIVE' || intent.slotHold.expiresAt <= new Date()) {
      throw new ConflictException('The slot hold expired before payment could be finalized. Payment requires reconciliation.');
    }
    const eligibility = await this.getPatientBookingEligibility(userId, intent.tenantId);
    if (!eligibility.canBook) throw new ForbiddenException('Patient eligibility changed before booking could be finalized.');

    await this.assertPublicBookingSelection(
      intent.tenantId,
      intent.slotHold.serviceId,
      intent.slotHold.branchId ?? '',
    );

    const booking: CreatePatientAppointmentDto = {
      tenantId: intent.tenantId,
      serviceId: intent.slotHold.serviceId,
      providerId: intent.slotHold.providerId,
      ...(intent.slotHold.branchId ? { branchId: intent.slotHold.branchId } : {}),
      ...(intent.slotHold.departmentId ? { departmentId: intent.slotHold.departmentId } : {}),
      startAt: intent.slotHold.startAt.toISOString(),
      endAt: intent.slotHold.endAt.toISOString(),
      timeZone: intent.slotHold.timeZone,
      ...(intent.slotHold.reason ? { reason: intent.slotHold.reason } : {}),
    };
    await this.validateResources(intent.tenantId, booking, intent.slotHold.branchId, intent.slotHold.departmentId);

    try {
      return await this.database.client.$transaction(async (tx) => {
        const currentIntent = await tx.appointmentPaymentIntent.findFirst({
          where: { id: intent.id, patientTenantRecordId: intent.patientTenantRecordId, status: { in: ['PENDING', 'RECONCILIATION_REQUIRED'] } },
          select: { id: true, status: true },
        });
        const currentHold = await tx.appointmentSlotHold.findFirst({
          where: { id: intent.slotHoldId, tenantId: intent.tenantId, patientTenantRecordId: intent.patientTenantRecordId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
          select: { id: true },
        });
        if (!currentIntent || !currentHold) throw new ConflictException('The paid slot is no longer available for automatic booking.');

        await this.validateProviderAvailability(
          tx,
          intent.tenantId,
          booking,
          intent.slotHold.branchId,
          intent.slotHold.departmentId,
          intent.slotHold.startAt,
          intent.slotHold.endAt,
          booking.timeZone,
        );
        const conflict = await tx.appointment.findFirst({
          where: {
            tenantId: intent.tenantId,
            status: { notIn: TERMINAL_STATUSES },
            startAt: { lt: intent.slotHold.endAt },
            endAt: { gt: intent.slotHold.startAt },
            OR: [
              { patientTenantRecordId: intent.patientTenantRecordId },
              { providerId: intent.slotHold.providerId },
            ],
          },
          select: { id: true },
        });
        if (conflict) throw new ConflictException('The slot was taken before booking could be finalized. Payment requires reconciliation.');

        const appointmentNumber = `APT-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
        const appointment = await tx.appointment.create({
          data: {
            tenantId: intent.tenantId,
            patientTenantRecordId: intent.patientTenantRecordId,
            providerId: intent.slotHold.providerId,
            branchId: intent.slotHold.branchId,
            departmentId: intent.slotHold.departmentId,
            serviceId: intent.slotHold.serviceId,
            appointmentNumber,
            bookingSource: AppointmentBookingSource.PATIENT_PORTAL,
            startAt: intent.slotHold.startAt,
            endAt: intent.slotHold.endAt,
            timeZone: booking.timeZone,
            reason: intent.slotHold.reason,
            createdByUserId: userId,
            slotHoldId: intent.slotHoldId,
            statusHistory: {
              create: {
                tenantId: intent.tenantId,
                fromStatus: null,
                toStatus: AppointmentStatus.REQUESTED,
                reason: 'Appointment deposit verified through M-Pesa STK Push',
                changedByUserId: userId,
              },
            },
          },
        });
        await tx.appointmentSlotHold.update({ where: { id: intent.slotHoldId }, data: { status: 'CONSUMED' } });
        await tx.appointmentPaymentIntent.update({
          where: { id: intent.id },
          data: { status: 'SUCCEEDED', providerReceipt, paidAt: new Date(), appointmentId: appointment.id },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: intent.tenantId,
            actorUserId: userId,
            branchId: intent.slotHold.branchId,
            action: 'PATIENT_APPOINTMENT_DEPOSIT_CONFIRMED',
            resourceType: 'APPOINTMENT',
            resourceId: appointment.id,
            outcome: 'SUCCESS',
            metadata: { appointmentNumber, paymentIntentId: intent.id, providerReceipt, amount: '100.00', currency: 'KES' },
          },
        });
        await this.notifyAppointmentParticipants(tx, {
          tenantId: intent.tenantId,
          patientUserId: userId,
          appointmentId: appointment.id,
          appointmentNumber,
          status: AppointmentStatus.REQUESTED,
          eventKey: `${appointment.id}:REQUESTED`,
          branchId: intent.slotHold.branchId,
          departmentId: intent.slotHold.departmentId,
          tenantName: intent.tenant.name,
        });
        return appointment;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000, maxWait: 15000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new ConflictException('Slot state changed during payment finalization; the payment requires reconciliation.');
      }
      throw error;
    }
  }

  async createForPatient(userId: string, dto: CreatePatientAppointmentDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const timeZone = dto.timeZone.trim();

    if (
      !Number.isFinite(startAt.getTime()) ||
      !Number.isFinite(endAt.getTime()) ||
      endAt <= startAt
    ) {
      throw new BadRequestException(
        'Appointment end time must be after its start time',
      );
    }

    if (startAt <= new Date()) {
      throw new BadRequestException(
        'Appointments must be booked for a future time',
      );
    }

    if (endAt.getTime() - startAt.getTime() > 12 * 60 * 60 * 1000) {
      throw new BadRequestException(
        'Appointment duration cannot exceed 12 hours',
      );
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(startAt);
    } catch {
      throw new BadRequestException('A valid IANA time zone is required');
    }

    const db = this.database.client;
    const profile = await db.patientProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException(
        'Create your Revaltrix patient profile before booking an appointment',
      );
    }

    const user = await db.user.findFirst({
      where: { id: userId, status: RecordStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Active patient account not found');
    const verifiedIdentity = await db.identity.findFirst({
      where: { userId, status: RecordStatus.ACTIVE, verifiedAt: { not: null } },
      select: { id: true },
    });
    if (!verifiedIdentity) {
      throw new ForbiddenException('Verify your account identity before booking an appointment.');
    }

    const tenant = await db.tenant.findFirst({
      where: {
        id: dto.tenantId,
        status: RecordStatus.ACTIVE,
        deletedAt: null,
        setup: { is: { status: 'LIVE' } },
      },
      select: { id: true, name: true },
    });

    if (!tenant) {
      throw new NotFoundException('This facility is not currently bookable');
    }

    const patient = await db.patientTenantRecord.findFirst({
      where: {
        tenantId: dto.tenantId,
        patientProfileId: profile.id,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!patient) {
      const existing = await db.patientTenantRecord.findFirst({
        where: {
          tenantId: dto.tenantId,
          patientProfileId: profile.id,
        },
        select: { status: true },
      });

      throw new ConflictException(
        existing
          ? `Your relationship with this facility is ${existing.status}. Contact the facility to complete registration before booking.`
          : 'You are not registered with this facility yet. Request facility registration before booking.',
      );
    }

    if (!dto.providerId) {
      throw new BadRequestException(
        'Select an available provider and appointment slot',
      );
    }
    const providerId = dto.providerId;

    const branchId = dto.branchId ?? null;
    const departmentId = dto.departmentId ?? null;

    await this.validateResources(
      dto.tenantId,
      dto,
      branchId,
      departmentId,
    );

    try {
      return await db.$transaction(
        async (tx) => {
          await this.validateProviderAvailability(
            tx,
            dto.tenantId,
            dto,
            branchId,
            departmentId,
            startAt,
            endAt,
            timeZone,
          );

          const conflict = await tx.appointment.findFirst({
            where: {
              tenantId: dto.tenantId,
              status: { notIn: TERMINAL_STATUSES },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              OR: [
                { patientTenantRecordId: patient.id },
                { providerId },
              ],
            },
            select: { id: true },
          });

          if (conflict) {
            throw new ConflictException(
              'The selected patient or provider has an overlapping appointment. Refresh availability and choose another slot.',
            );
          }

          const appointmentNumber =
            `APT-${new Date().getUTCFullYear()}-${randomUUID()
              .replace(/-/g, '')
              .slice(0, 12)
              .toUpperCase()}`;

          const appointment = await tx.appointment.create({
            data: {
              tenantId: dto.tenantId,
              patientTenantRecordId: patient.id,
              providerId,
              branchId,
              departmentId,
              serviceId: dto.serviceId,
              appointmentNumber,
              bookingSource: AppointmentBookingSource.PATIENT_PORTAL,
              startAt,
              endAt,
              timeZone,
              reason: dto.reason?.trim() || null,
              patientNotes: dto.patientNotes?.trim() || null,
              createdByUserId: userId,
              statusHistory: {
                create: {
                  tenantId: dto.tenantId,
                  fromStatus: null,
                  toStatus: AppointmentStatus.REQUESTED,
                  reason: 'Appointment requested through patient portal',
                  changedByUserId: userId,
                },
              },
            },
            include: {
              statusHistory: { orderBy: { createdAt: 'asc' } },
            },
          });

          await tx.auditEvent.create({
            data: {
              tenantId: dto.tenantId,
              branchId,
              actorUserId: userId,
              action: 'PATIENT_APPOINTMENT_REQUESTED',
              resourceType: 'APPOINTMENT',
              resourceId: appointment.id,
              outcome: 'SUCCESS',
              reason: 'Patient requested an appointment through the portal',
              metadata: {
                appointmentNumber,
                patientTenantRecordId: patient.id,
                providerId: appointment.providerId,
                branchId: appointment.branchId,
                departmentId: appointment.departmentId,
                serviceId: appointment.serviceId,
                startAt: startAt.toISOString(),
                endAt: endAt.toISOString(),
              },
            },
          });

          await this.notifyAppointmentParticipants(tx, {
            tenantId: dto.tenantId,
            patientUserId: userId,
            appointmentId: appointment.id,
            appointmentNumber,
            status: AppointmentStatus.REQUESTED,
            eventKey: `${appointment.id}:REQUESTED`,
            branchId,
            departmentId,
            tenantName: tenant.name,
          });

          return appointment;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
          maxWait: 15000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          throw new ConflictException(
            'Appointment availability changed concurrently. Refresh and try again.',
          );
        }
        if (error.code === 'P2002') {
          throw new ConflictException(
            'Appointment number collision. Please retry the request.',
          );
        }
      }
      throw error;
    }
  }

  async createRecurringForStaff(
    userId: string,
    dto: CreateRecurringAppointmentDto,
  ) {
    const context = await this.authorization.getContext(userId);
    const timeZone = dto.timeZone.trim();
    const intervalWeeks = dto.intervalWeeks ?? 1;
    const maxOccurrences = dto.maxOccurrences;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const parseLocalDate = (value: string, field: string): Date => {
      if (!datePattern.test(value)) {
        throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
      }
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
      ) {
        throw new BadRequestException(`${field} must be a real calendar date`);
      }
      return parsed;
    };

    const startDate = parseLocalDate(dto.startDate, 'startDate');
    const endDate = dto.endDate
      ? parseLocalDate(dto.endDate, 'endDate')
      : null;

    if (!endDate && !maxOccurrences) {
      throw new BadRequestException(
        'Provide endDate or maxOccurrences to bound the recurring schedule',
      );
    }
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 52) {
      throw new BadRequestException('intervalWeeks must be between 1 and 52');
    }
    if (
      maxOccurrences !== undefined &&
      (!Number.isInteger(maxOccurrences) || maxOccurrences < 1 || maxOccurrences > 52)
    ) {
      throw new BadRequestException('maxOccurrences must be between 1 and 52');
    }
    if (!Array.isArray(dto.weekdays) || dto.weekdays.length === 0 ||
      new Set(dto.weekdays).size !== dto.weekdays.length ||
      dto.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new BadRequestException('weekdays must contain unique day numbers from 0 (Sunday) to 6 (Saturday)');
    }
    if (dto.startMinute < 0 || dto.startMinute > 1439 ||
      !Number.isInteger(dto.startMinute)) {
      throw new BadRequestException('startMinute must be between 0 and 1439');
    }
    if (!Number.isInteger(dto.durationMinutes) ||
      dto.durationMinutes < 5 || dto.durationMinutes > 720) {
      throw new BadRequestException('durationMinutes must be between 5 and 720');
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(startDate);
    } catch {
      throw new BadRequestException('A valid IANA time zone is required');
    }

    const localDateKey = (date: Date) =>
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

    const instantForLocalMinute = (
      dateKey: string,
      minute: number,
    ): Date | null => {
      const dateParts = dateKey.split('-').map(Number);
      const year = dateParts[0];
      const month = dateParts[1];
      const day = dateParts[2];
      if (year === undefined || month === undefined || day === undefined) {
        return null;
      }
      const desired = Date.UTC(
        year, month - 1, day, Math.floor(minute / 60), minute % 60,
      );
      let guess = desired;

      for (let i = 0; i < 6; i++) {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(new Date(guess));
        const get = (type: string) =>
          parts.find((part) => part.type === type)?.value ?? '0';
        const actual = Date.UTC(
          Number(get('year')),
          Number(get('month')) - 1,
          Number(get('day')),
          Number(get('hour')),
          Number(get('minute')),
        );
        const correction = desired - actual;
        guess += correction;
        if (correction === 0) break;
      }

      const result = new Date(guess);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(result);
      const get = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? '';
      const actualKey = `${get('year')}-${get('month')}-${get('day')}`;
      const actualMinute = Number(get('hour')) * 60 + Number(get('minute'));

      return actualKey === dateKey && actualMinute === minute ? result : null;
    };

    const todayInZone = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const occurrences: Array<{ startAt: Date; endAt: Date; localDate: string }> = [];
    const firstDay = startDate.getUTCDay();
    const firstWeekSunday = new Date(startDate);
    firstWeekSunday.setUTCDate(startDate.getUTCDate() - firstDay);

    for (
      let cursor = new Date(startDate);
      !endDate || cursor <= endDate;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const weekNumber = Math.floor(
        (cursor.getTime() - firstWeekSunday.getTime()) / (7 * 86400000),
      );
      if (
        cursor < startDate ||
        weekNumber % intervalWeeks !== 0 ||
        !dto.weekdays.includes(cursor.getUTCDay())
      ) {
        continue;
      }

      const localDate = localDateKey(cursor);
      if (localDate < todayInZone) {
        continue;
      }

      const startAt = instantForLocalMinute(localDate, dto.startMinute);
      if (!startAt || startAt <= new Date()) {
        throw new BadRequestException(
          `The requested local appointment time is invalid or not in the future on ${localDate}`,
        );
      }
      const endAt = new Date(startAt.getTime() + dto.durationMinutes * 60000);
      const endDateInZone = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(endAt);
      if (endDateInZone !== localDate) {
        throw new BadRequestException(
          `Appointments must fit within one local calendar day (${localDate})`,
        );
      }

      occurrences.push({ startAt, endAt, localDate });
      if (maxOccurrences && occurrences.length >= maxOccurrences) break;
      if (occurrences.length > 52) {
        throw new BadRequestException(
          'A recurring series cannot contain more than 52 appointments',
        );
      }
    }

    if (occurrences.length === 0) {
      throw new BadRequestException(
        'The recurrence rules did not produce any future appointments',
      );
    }
    if (endDate && !maxOccurrences) {
      const lastOccurrence = occurrences[occurrences.length - 1];
      if (!lastOccurrence) {
        throw new BadRequestException('No valid recurrence dates were generated');
      }
      const lastGenerated = lastOccurrence.localDate;
      const hasMoreMatchingDates = (() => {
        const probe = new Date(`${lastGenerated}T00:00:00.000Z`);
        probe.setUTCDate(probe.getUTCDate() + 1);
        for (let cursor = probe; cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const weekNumber = Math.floor(
            (cursor.getTime() - firstWeekSunday.getTime()) / (7 * 86400000),
          );
          if (weekNumber % intervalWeeks === 0 && dto.weekdays.includes(cursor.getUTCDay())) {
            return true;
          }
        }
        return false;
      })();
      if (hasMoreMatchingDates) {
        throw new BadRequestException(
          'This schedule exceeds the 52-appointment limit; provide an earlier endDate or maxOccurrences',
        );
      }
    }

    if (!dto.providerId && !dto.serviceId && !dto.departmentId) {
      throw new BadRequestException(
        'Select at least a provider, service, or department',
      );
    }

    const branchId = dto.branchId ?? context.branchId ?? null;
    const departmentId = dto.departmentId ?? context.departmentId ?? null;
    const first = occurrences[0];
    if (!first) {
      throw new BadRequestException('No valid recurrence dates were generated');
    }
    const firstAppointmentDto: CreateAppointmentDto = {
      patientTenantRecordId: dto.patientTenantRecordId,
      ...(dto.providerId ? { providerId: dto.providerId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(dto.serviceId ? { serviceId: dto.serviceId } : {}),
      startAt: first.startAt.toISOString(),
      endAt: first.endAt.toISOString(),
      timeZone,
      ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      ...(dto.patientNotes !== undefined ? { patientNotes: dto.patientNotes } : {}),
    };

    await this.validateResources(
      context.tenantId, firstAppointmentDto, branchId, departmentId,
    );

    const reason = dto.reason?.trim() || null;
    const patientNotes = dto.patientNotes?.trim() || null;

    try {
      return await this.database.client.$transaction(
        async (tx) => {
          const patient = await tx.patientTenantRecord.findFirst({
            where: {
              id: dto.patientTenantRecordId,
              tenantId: context.tenantId,
              status: 'ACTIVE',
              deletedAt: null,
            },
            select: {
              id: true,
              patientProfile: { select: { userId: true } },
            },
          });
          if (!patient) {
            throw new BadRequestException(
              'Patient must be an active patient of this facility',
            );
          }

          const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: context.tenantId },
            select: { name: true },
          });

          const appointmentDtos = occurrences.map((occurrence): CreateAppointmentDto => ({
            ...firstAppointmentDto,
            startAt: occurrence.startAt.toISOString(),
            endAt: occurrence.endAt.toISOString(),
          }));

          for (const occurrence of occurrences) {
            if (dto.providerId) {
              await this.validateProviderAvailability(
                tx,
                context.tenantId,
                {
                  ...firstAppointmentDto,
                  startAt: occurrence.startAt.toISOString(),
                  endAt: occurrence.endAt.toISOString(),
                },
                branchId,
                departmentId,
                occurrence.startAt,
                occurrence.endAt,
                timeZone,
              );

              const heldSlot = await tx.appointmentSlotHold.findFirst({
                where: {
                  tenantId: context.tenantId,
                  providerId: dto.providerId,
                  status: 'ACTIVE',
                  expiresAt: { gt: new Date() },
                  startAt: { lt: occurrence.endAt },
                  endAt: { gt: occurrence.startAt },
                },
                select: { id: true },
              });
              if (heldSlot) {
                throw new ConflictException(
                  `One of the requested times is temporarily reserved (${occurrence.localDate})`,
                );
              }
            }

            const conflict = await tx.appointment.findFirst({
              where: {
                tenantId: context.tenantId,
                status: { notIn: TERMINAL_STATUSES },
                startAt: { lt: occurrence.endAt },
                endAt: { gt: occurrence.startAt },
                OR: [
                  { patientTenantRecordId: patient.id },
                  ...(dto.providerId ? [{ providerId: dto.providerId }] : []),
                ],
              },
              select: { id: true, appointmentNumber: true },
            });
            if (conflict) {
              throw new ConflictException(
                `A patient or provider appointment overlaps the requested recurrence on ${occurrence.localDate}`,
              );
            }
          }

          const series = await tx.appointmentSeries.create({
            data: {
              tenantId: context.tenantId,
              patientTenantRecordId: patient.id,
              providerId: dto.providerId ?? null,
              branchId,
              departmentId,
              serviceId: dto.serviceId ?? null,
              createdByUserId: userId,
              timeZone,
              startDate,
              endDate,
              maxOccurrences: maxOccurrences ?? null,
              generatedThrough: new Date(`${occurrences[occurrences.length - 1]!.localDate}T00:00:00.000Z`),
              weekdays: [...dto.weekdays].sort((a, b) => a - b),
              intervalWeeks,
              startMinute: dto.startMinute,
              durationMinutes: dto.durationMinutes,
              reason,
              patientNotes,
            },
          });

          const appointments = [];
          for (const occurrence of occurrences) {
            const appointmentNumber =
              `APT-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

            const appointment = await tx.appointment.create({
              data: {
                tenantId: context.tenantId,
                patientTenantRecordId: patient.id,
                providerId: dto.providerId ?? null,
                branchId,
                departmentId,
                serviceId: dto.serviceId ?? null,
                seriesId: series.id,
                appointmentNumber,
                bookingSource: AppointmentBookingSource.STAFF,
                startAt: occurrence.startAt,
                endAt: occurrence.endAt,
                timeZone,
                reason,
                patientNotes,
                createdByUserId: userId,
                statusHistory: {
                  create: {
                    tenantId: context.tenantId,
                    fromStatus: null,
                    toStatus: AppointmentStatus.REQUESTED,
                    reason: 'Recurring appointment created',
                    changedByUserId: userId,
                  },
                },
              },
              include: {
                statusHistory: { orderBy: { createdAt: 'asc' } },
              },
            });
            appointments.push(appointment);

            await tx.auditEvent.create({
              data: {
                tenantId: context.tenantId,
                actorUserId: userId,
                branchId,
                action: 'APPOINTMENT_CREATED',
                resourceType: 'APPOINTMENT',
                resourceId: appointment.id,
                outcome: 'SUCCESS',
                reason: 'Recurring appointment created',
                metadata: {
                  appointmentNumber,
                  seriesId: series.id,
                  patientTenantRecordId: patient.id,
                  providerId: appointment.providerId,
                  branchId: appointment.branchId,
                  departmentId: appointment.departmentId,
                  serviceId: appointment.serviceId,
                  startAt: occurrence.startAt.toISOString(),
                  endAt: occurrence.endAt.toISOString(),
                },
              },
            });

            await this.notifyAppointmentParticipants(tx, {
              tenantId: context.tenantId,
              patientUserId: patient.patientProfile.userId,
              appointmentId: appointment.id,
              appointmentNumber,
              status: AppointmentStatus.REQUESTED,
              eventKey: `${appointment.id}:REQUESTED`,
              branchId,
              departmentId,
              tenantName: tenant.name,
            });
          }

          return { series, appointments };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
          maxWait: 15000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          throw new ConflictException(
            'Appointment availability changed concurrently. Refresh and try again.',
          );
        }
        if (error.code === 'P2002') {
          throw new ConflictException(
            'Appointment number collision. Please retry the request.',
          );
        }
      }
      throw error;
    }
  }

  async createForStaff(userId: string, dto: CreateAppointmentDto) {
    const context = await this.authorization.getContext(userId);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const timeZone = dto.timeZone.trim();

    if (
      !Number.isFinite(startAt.getTime()) ||
      !Number.isFinite(endAt.getTime()) ||
      endAt <= startAt
    ) {
      throw new BadRequestException(
        'Appointment end time must be after its start time',
      );
    }

    if (startAt <= new Date()) {
      throw new BadRequestException(
        'Appointments must be booked for a future time',
      );
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(startAt);
    } catch {
      throw new BadRequestException('A valid IANA time zone is required');
    }

    const patient = await this.database.client.patientTenantRecord.findFirst({
      where: {
        id: dto.patientTenantRecordId,
        tenantId: context.tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, patientProfile: { select: { userId: true } } },
    });

    if (!patient) {
      throw new BadRequestException(
        'Patient must be an active patient of this facility',
      );
    }

    if (!dto.providerId && !dto.serviceId && !dto.departmentId) {
      throw new BadRequestException(
        'Select at least a provider, service, or department',
      );
    }

    const branchId = dto.branchId ?? context.branchId ?? null;
    const departmentId = dto.departmentId ?? context.departmentId ?? null;

    await this.validateResources(
      context.tenantId,
      dto,
      branchId,
      departmentId,
    );

    const durationMs = endAt.getTime() - startAt.getTime();
    if (durationMs > 12 * 60 * 60 * 1000) {
      throw new BadRequestException(
        'Appointment duration cannot exceed 12 hours',
      );
    }

    const reason = dto.reason?.trim() || null;
    const patientNotes = dto.patientNotes?.trim() || null;

    try {
      return await this.database.client.$transaction(
        async (tx) => {
          if (dto.providerId) {
            await this.validateProviderAvailability(
              tx,
              context.tenantId,
              dto,
              branchId,
              departmentId,
              startAt,
              endAt,
              timeZone,
            );
            const heldSlot = await tx.appointmentSlotHold.findFirst({
              where: {
                tenantId: context.tenantId,
                providerId: dto.providerId,
                status: 'ACTIVE',
                expiresAt: { gt: new Date() },
                startAt: { lt: endAt },
                endAt: { gt: startAt },
              },
              select: { id: true },
            });
            if (heldSlot) throw new ConflictException('This time is temporarily reserved for a patient completing payment.');
          }

          const conflict = await tx.appointment.findFirst({
            where: {
              tenantId: context.tenantId,
              status: { notIn: TERMINAL_STATUSES },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              OR: [
                { patientTenantRecordId: patient.id },
                ...(dto.providerId ? [{ providerId: dto.providerId }] : []),
              ],
            },
            select: { id: true, appointmentNumber: true },
          });

          if (conflict) {
            throw new ConflictException(
              'The selected patient or provider has an overlapping appointment',
            );
          }

          const appointmentNumber =
            `APT-${new Date().getUTCFullYear()}-${randomUUID()
              .replace(/-/g, '')
              .slice(0, 12)
              .toUpperCase()}`;

          const appointment = await tx.appointment.create({
            data: {
              tenantId: context.tenantId,
              patientTenantRecordId: patient.id,
              providerId: dto.providerId ?? null,
              branchId,
              departmentId,
              serviceId: dto.serviceId ?? null,
              appointmentNumber,
              bookingSource: AppointmentBookingSource.STAFF,
              startAt,
              endAt,
              timeZone,
              reason,
              patientNotes,
              createdByUserId: userId,
              statusHistory: {
                create: {
                  tenantId: context.tenantId,
                  fromStatus: null,
                  toStatus: AppointmentStatus.REQUESTED,
                  reason: 'Appointment created',
                  changedByUserId: userId,
                },
              },
            },
            include: {
              statusHistory: { orderBy: { createdAt: 'asc' } },
            },
          });

          await tx.auditEvent.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: userId,
              branchId,
              action: 'APPOINTMENT_CREATED',
              resourceType: 'APPOINTMENT',
              resourceId: appointment.id,
              outcome: 'SUCCESS',
              reason: 'Appointment created',
              metadata: {
                appointmentNumber,
                patientTenantRecordId: patient.id,
                providerId: appointment.providerId,
                branchId: appointment.branchId,
                departmentId: appointment.departmentId,
                serviceId: appointment.serviceId,
                startAt: startAt.toISOString(),
                endAt: endAt.toISOString(),
              },
            },
          });

          const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { name: true } });
          await this.notifyAppointmentParticipants(tx, {
            tenantId: context.tenantId,
            patientUserId: patient.patientProfile.userId,
            appointmentId: appointment.id,
            appointmentNumber,
            status: AppointmentStatus.REQUESTED,
            eventKey: `${appointment.id}:REQUESTED`,
            branchId,
            departmentId,
            tenantName: tenant.name,
          });

          return appointment;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30000,
          maxWait: 15000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          throw new ConflictException(
            'Appointment availability changed concurrently. Refresh and try again.',
          );
        }
        if (error.code === 'P2002') {
          throw new ConflictException(
            'Appointment number collision. Please retry the request.',
          );
        }
      }
      throw error;
    }
  }

  async listForPatient(userId: string) {
    const profile = await this.database.client.patientProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }

    return this.database.client.appointment.findMany({
      where: {
        patientTenantRecord: {
          is: {
            patientProfileId: profile.id,
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        appointmentNumber: true,
        status: true,
        bookingSource: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        reason: true,
        createdAt: true,
        tenant: {
          select: {
            id: true,
            name: true,
            legalName: true,
          },
        },
        branch: {
          select: { id: true, name: true },
        },
        department: {
          select: { id: true, name: true },
        },
        service: {
          select: { id: true, name: true, code: true },
        },
        provider: {
          select: {
            professionalTitle: true,
            specialty: true,
          },
        },
        paymentIntents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, amount: true, currency: true, providerReceipt: true, paidAt: true },
        },
        refunds: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, amount: true, currency: true, refundMethod: true, reason: true, evidenceRef: true, providerReference: true, createdAt: true },
        },
      },
      orderBy: { startAt: 'desc' },
      take: 200,
    });
  }

  async listForStaff(userId: string, query: AppointmentQueryDto) {
    const context = await this.authorization.getContext(userId);

    if (
      query.from &&
      query.to &&
      new Date(query.from) > new Date(query.to)
    ) {
      throw new BadRequestException(
        'The from date must be before or equal to the to date',
      );
    }

    return this.database.client.appointment.findMany({
      where: {
        tenantId: context.tenantId,
        ...(context.branchId ? { branchId: context.branchId } : {}),
        ...(context.departmentId ? { departmentId: context.departmentId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.patientTenantRecordId
          ? { patientTenantRecordId: query.patientTenantRecordId }
          : {}),
        ...(query.providerId ? { providerId: query.providerId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.from || query.to
          ? {
              startAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { startAt: 'asc' },
      include: {
        patientTenantRecord: {
          select: { id: true, patientNumber: true },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            professionalTitle: true,
            specialty: true,
          },
        },
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, code: true } },
        paymentIntents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, internalReference: true, status: true, amount: true, currency: true, providerReceipt: true, paidAt: true },
        },
        refunds: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, amount: true, currency: true, reason: true, evidenceRef: true, providerReference: true, createdAt: true },
        },
      },
      take: 200,
    });
  }

  async getForStaff(userId: string, appointmentId: string) {
    const context = await this.authorization.getContext(userId);

    const appointment = await this.database.client.appointment.findFirst({
      where: {
        id: appointmentId,
        tenantId: context.tenantId,
        ...(context.branchId ? { branchId: context.branchId } : {}),
        ...(context.departmentId ? { departmentId: context.departmentId } : {}),
      },
      include: {
        patientTenantRecord: {
          select: { id: true, patientNumber: true },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            professionalTitle: true,
            specialty: true,
          },
        },
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, code: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        encounter: { select: { id: true, encounterNumber: true, status: true } },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async transitionForStaff(
    userId: string,
    appointmentId: string,
    toStatus: AppointmentStatus,
    dto: TransitionAppointmentDto = {},
  ) {
    const context = await this.authorization.getContext(userId);
    const reason = dto.reason?.trim() || null;
    const staffNotes = dto.staffNotes?.trim();

    return this.database.client.$transaction(
      async (tx) => {
        const appointment = await tx.appointment.findFirst({
          where: {
            id: appointmentId,
            tenantId: context.tenantId,
            ...(context.branchId ? { branchId: context.branchId } : {}),
            ...(context.departmentId ? { departmentId: context.departmentId } : {}),
          },
        });

        if (!appointment) {
          throw new NotFoundException('Appointment not found');
        }

        if (
          toStatus === AppointmentStatus.CHECKED_IN &&
          appointment.status === AppointmentStatus.CHECKED_IN
        ) {
          await this.encounters.ensureAppointmentEncounterCheckedIn(
            userId,
            tx,
            appointment,
            reason,
          );
          return appointment;
        }

        if (!TRANSITIONS[appointment.status]?.includes(toStatus)) {
          throw new BadRequestException(
            `Cannot transition appointment from ${appointment.status} to ${toStatus}`,
          );
        }

        if (
          toStatus === AppointmentStatus.CANCELLED &&
          !reason
        ) {
          throw new BadRequestException(
            'A cancellation reason is required',
          );
        }

        if (
          toStatus === AppointmentStatus.NO_SHOW &&
          appointment.endAt > new Date()
        ) {
          throw new BadRequestException(
            'An appointment cannot be marked no-show before its scheduled end',
          );
        }
        if (toStatus === AppointmentStatus.NO_SHOW && (!reason || reason.length < 3)) {
          throw new BadRequestException('A documented reason is required before flagging a no-show. The patient may dispute this decision.');
        }

        const updated = await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: toStatus,
            ...(staffNotes !== undefined ? { staffNotes } : {}),
            ...(toStatus === AppointmentStatus.CANCELLED
              ? { cancellationReason: reason, cancelledAt: new Date() }
              : {}),
            ...(toStatus === AppointmentStatus.CHECKED_IN
              ? { checkedInAt: new Date() }
              : {}),
            statusHistory: {
              create: {
                tenantId: context.tenantId,
                fromStatus: appointment.status,
                toStatus,
                reason,
                changedByUserId: userId,
              },
            },
          },
        });

        if (toStatus === AppointmentStatus.CHECKED_IN) {
          await this.encounters.ensureAppointmentEncounterCheckedIn(
            userId,
            tx,
            appointment,
            reason,
          );
        }

        await tx.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: appointment.branchId ?? context.branchId,
            action: 'APPOINTMENT_STATUS_CHANGED',
            resourceType: 'APPOINTMENT',
            resourceId: appointment.id,
            outcome: 'SUCCESS',
            reason: reason ?? `Appointment transitioned to ${toStatus}`,
            metadata: {
              appointmentNumber: appointment.appointmentNumber,
              fromStatus: appointment.status,
              toStatus,
            },
          },
        });

        const patient = await tx.patientTenantRecord.findFirst({
          where: { id: appointment.patientTenantRecordId, tenantId: context.tenantId },
          select: { patientProfile: { select: { userId: true } } },
        });
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { name: true } });
        if (patient) {
          await this.notifyAppointmentParticipants(tx, {
            tenantId: context.tenantId,
            patientUserId: patient.patientProfile.userId,
            appointmentId: appointment.id,
            appointmentNumber: appointment.appointmentNumber,
            status: toStatus,
            eventKey: `${appointment.id}:${toStatus}:${updated.updatedAt.toISOString()}`,
            branchId: appointment.branchId ?? context.branchId,
            departmentId: appointment.departmentId ?? context.departmentId,
            tenantName: tenant.name,
          });
        }

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
        maxWait: 15000,
      },
    ).catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Appointment changed concurrently. Refresh and try again.',
        );
      }
      throw error;
    });
  }

  async requestPatientRefund(userId: string, appointmentId: string, dto: RequestAppointmentRefundDto) {
    const appointment = await this.database.client.appointment.findFirst({
      where: { id: appointmentId, patientTenantRecord: { is: { patientProfile: { is: { userId } } } } },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        departmentId: true,
        appointmentNumber: true,
        status: true,
        paymentIntents: { where: { status: 'SUCCEEDED' }, select: { id: true, amount: true, currency: true }, take: 1 },
        refunds: { where: { status: { notIn: ['FAILED', 'NOT_ELIGIBLE'] } }, select: { id: true, status: true }, take: 1 },
        patientTenantRecord: { select: { patientProfile: { select: { userId: true } } } },
      },
    });
    if (!appointment?.paymentIntents[0]) throw new NotFoundException('Paid appointment not found.');
    if (appointment.paymentIntents[0].currency !== 'KES' || appointment.paymentIntents[0].amount.toNumber() !== 100) {
      throw new ConflictException('The original deposit amount is not eligible for this refund workflow.');
    }
    if (!['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(appointment.status)) {
      throw new ConflictException('Refund requests are available after cancellation, rejection, or a no-show decision.');
    }
    if (appointment.refunds.length) return { id: appointment.refunds[0]!.id, status: appointment.refunds[0]!.status };
    const status = appointment.status === 'NO_SHOW' ? 'DISPUTED' : 'REQUESTED';
    const tenant = await this.database.client.tenant.findUniqueOrThrow({ where: { id: appointment.tenantId }, select: { name: true } });
    return this.database.client.$transaction(async (tx) => {
      const existingRefund = await tx.appointmentRefund.findFirst({
        where: { paymentIntentId: appointment.paymentIntents[0]!.id, status: { notIn: ['FAILED', 'NOT_ELIGIBLE', 'REFUNDED'] } },
        select: { id: true, status: true },
      });
      if (existingRefund) return { id: existingRefund.id, status: existingRefund.status };
      const refund = await tx.appointmentRefund.create({
        data: {
          tenantId: appointment.tenantId,
          appointmentId: appointment.id,
          paymentIntentId: appointment.paymentIntents[0]!.id,
          amount: new Prisma.Decimal(100),
          currency: 'KES',
          status,
          reason: dto.reason.trim(),
          actorUserId: userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: appointment.tenantId,
          actorUserId: userId,
          branchId: appointment.branchId,
          action: status === 'DISPUTED' ? 'APPOINTMENT_NO_SHOW_DISPUTED' : 'APPOINTMENT_REFUND_REQUESTED',
          resourceType: 'APPOINTMENT_REFUND',
          resourceId: refund.id,
          outcome: 'SUCCESS',
          reason: dto.reason.trim(),
          metadata: { appointmentId: appointment.id, appointmentNumber: appointment.appointmentNumber, paymentIntentId: appointment.paymentIntents[0]!.id, amount: '100.00', currency: 'KES' },
        },
      });
      const staff = await tx.membership.findMany({
        where: {
          tenantId: appointment.tenantId,
          status: 'ACTIVE',
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          AND: [
            { OR: [{ branchId: null }, ...(appointment.branchId ? [{ branchId: appointment.branchId }] : [])] },
            { OR: [{ departmentId: null }, ...(appointment.departmentId ? [{ departmentId: appointment.departmentId }] : [])] },
          ],
          roles: { some: { role: { permissions: { some: { permission: { scope: 'TENANT', resource: 'appointments', action: 'update', effect: 'ALLOW', status: 'ACTIVE', OR: [{ tenantId: null }, { tenantId: appointment.tenantId }] } } } } } },
          NOT: { roles: { some: { role: { permissions: { some: { permission: { scope: 'TENANT', resource: 'appointments', effect: 'DENY', status: 'ACTIVE', OR: [{ tenantId: null }, { tenantId: appointment.tenantId }] } } } } } } },
        },
        select: { userId: true },
      });
      const recipients = [...new Set([userId, ...staff.map(({ userId: recipient }) => recipient)])];
      await Promise.all(recipients.map((recipientUserId) => {
        const isPatient = recipientUserId === userId;
        return this.notifications.createNotificationInTransaction(tx, {
          tenantId: appointment.tenantId,
          recipientUserId,
          type: status === 'DISPUTED' ? 'APPOINTMENT_NO_SHOW_DISPUTED' : 'APPOINTMENT_REFUND_REQUESTED',
          title: status === 'DISPUTED' ? 'No-show decision disputed' : 'Appointment refund requested',
          body: isPatient
            ? `Your refund request for appointment ${appointment.appointmentNumber} is recorded for facility review.`
            : `Appointment ${appointment.appointmentNumber} has a patient refund request that needs review.`,
          data: { appointmentId: appointment.id, refundId: refund.id },
          channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
          idempotencyPrefix: `${refund.id}:${recipientUserId}`,
        });
      }));
      return { id: refund.id, status: refund.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reviewAppointmentRefund(userId: string, appointmentId: string, refundId: string, dto: ReviewAppointmentRefundDto) {
    const context = await this.authorization.assertPermission(userId, { resource: 'appointments', action: 'update' });
    const [appointment, refund] = await Promise.all([
      this.database.client.appointment.findFirst({
        where: { id: appointmentId, tenantId: context.tenantId },
        select: { id: true, tenantId: true, branchId: true, departmentId: true, appointmentNumber: true, status: true, patientTenantRecord: { select: { patientProfile: { select: { userId: true } } } } },
      }),
      this.database.client.appointmentRefund.findFirst({ where: { id: refundId, appointmentId, tenantId: context.tenantId } }),
    ]);
    if (!appointment || !refund) throw new NotFoundException('Appointment refund not found.');
    if (context.branchId && context.branchId !== appointment.branchId) throw new ForbiddenException('Branch access is required to review this refund.');
    if (context.departmentId && context.departmentId !== appointment.departmentId) throw new ForbiddenException('Department access is required to review this refund.');
    if (refund.actorUserId === userId) throw new ForbiddenException('A different authorized reviewer must decide this refund.');
    const allowedRefundTransitions: Record<string, string[]> = {
      ELIGIBLE: ['PENDING', 'REFUNDED', 'FAILED', 'NOT_ELIGIBLE'],
      REQUESTED: ['PENDING', 'REFUNDED', 'FAILED', 'DISPUTED', 'NOT_ELIGIBLE'],
      PENDING: ['REFUNDED', 'FAILED', 'DISPUTED'],
      DISPUTED: ['PENDING', 'REFUNDED', 'FAILED', 'NOT_ELIGIBLE'],
      FAILED: ['PENDING', 'DISPUTED'],
      REFUNDED: [],
      NOT_ELIGIBLE: ['DISPUTED'],
    };
    if (!allowedRefundTransitions[refund.status]?.includes(dto.status)) {
      throw new ConflictException(`Refund cannot transition from ${refund.status} to ${dto.status}.`);
    }
    if (dto.status === 'REFUNDED' && (!dto.evidenceRef?.trim() || !dto.refundMethod || (dto.refundMethod !== 'CASH' && !dto.providerReference?.trim()))) {
      throw new BadRequestException('Refund evidence and method are required; electronic refunds also require the provider transaction reference.');
    }
    const totalRefunded = await this.database.client.appointmentRefund.aggregate({
      where: { paymentIntentId: refund.paymentIntentId, status: 'REFUNDED', id: { not: refund.id } },
      _sum: { amount: true },
    });
    const alreadyRefunded = totalRefunded._sum.amount?.toNumber() ?? 0;
    if (alreadyRefunded + refund.amount.toNumber() > 100) throw new ConflictException('Refund amount exceeds the original KSh 100 deposit.');
    const tenant = await this.database.client.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { name: true } });
    return this.database.client.$transaction(async (tx) => {
      const updated = await tx.appointmentRefund.update({
        where: { id: refund.id },
        data: {
          status: dto.status,
          reason: dto.reason.trim(),
          ...(dto.refundMethod ? { refundMethod: dto.refundMethod } : {}),
          ...(dto.evidenceRef?.trim() ? { evidenceRef: dto.evidenceRef.trim() } : {}),
          ...(dto.providerReference?.trim() ? { providerReference: dto.providerReference.trim() } : {}),
          reviewedByUserId: userId,
          reviewedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: userId,
          branchId: appointment.branchId,
          action: 'APPOINTMENT_REFUND_REVIEWED',
          resourceType: 'APPOINTMENT_REFUND',
          resourceId: refund.id,
          outcome: 'SUCCESS',
          reason: dto.reason.trim(),
          metadata: { appointmentId, appointmentNumber: appointment.appointmentNumber, status: dto.status, amount: refund.amount.toString(), currency: refund.currency, evidenceRef: dto.evidenceRef ?? null, providerReference: dto.providerReference ?? null },
        },
      });
      const memberships = await tx.membership.findMany({
        where: {
          tenantId: context.tenantId,
          status: 'ACTIVE',
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          AND: [
            { OR: [{ branchId: null }, ...(appointment.branchId ? [{ branchId: appointment.branchId }] : [])] },
            { OR: [{ departmentId: null }, ...(appointment.departmentId ? [{ departmentId: appointment.departmentId }] : [])] },
          ],
          roles: { some: { role: { permissions: { some: { permission: { scope: 'TENANT', resource: 'appointments', action: 'read', effect: 'ALLOW', status: 'ACTIVE', OR: [{ tenantId: null }, { tenantId: context.tenantId }] } } } } } },
          NOT: { roles: { some: { role: { permissions: { some: { permission: { scope: 'TENANT', resource: 'appointments', effect: 'DENY', status: 'ACTIVE', OR: [{ tenantId: null }, { tenantId: context.tenantId }] } } } } } } },
        },
        select: { userId: true },
      });
      const recipients = [...new Set([appointment.patientTenantRecord.patientProfile.userId, ...memberships.map(({ userId: recipient }) => recipient)])];
      await Promise.all(recipients.map((recipientUserId) => this.notifications.createNotificationInTransaction(tx, {
        tenantId: context.tenantId,
        recipientUserId,
        type: `APPOINTMENT_REFUND_${dto.status}`,
        title: 'Appointment refund update',
        body: recipientUserId === appointment.patientTenantRecord.patientProfile.userId
          ? `Refund status for appointment ${appointment.appointmentNumber} is ${dto.status.toLowerCase().replaceAll('_', ' ')}.`
          : `Refund for appointment ${appointment.appointmentNumber} was updated to ${dto.status.toLowerCase().replaceAll('_', ' ')}.`,
        data: { appointmentId, refundId: refund.id, status: dto.status },
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        idempotencyPrefix: `${refund.id}:${dto.status}:${updated.updatedAt.toISOString()}:${recipientUserId}`,
      })));
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async validateResources(
    tenantId: string,
    dto: CreateAppointmentDto | CreatePatientAppointmentDto,
    branchId: string | null,
    departmentId: string | null,
  ) {
    const db = this.database.client;

    if (dto.providerId) {
      const provider = await db.providerProfile.findFirst({
        where: {
          id: dto.providerId,
          tenantId,
          status: RecordStatus.ACTIVE,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!provider) {
        throw new BadRequestException(
          'Provider does not belong to this facility or is not active',
        );
      }
    }

    if (branchId) {
      const branch = await db.branch.findFirst({
        where: {
          id: branchId,
          tenantId,
          status: RecordStatus.ACTIVE,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException(
          'Branch does not belong to this facility or is not active',
        );
      }
    }

    if (departmentId) {
      const department = await db.department.findFirst({
        where: {
          id: departmentId,
          tenantId,
          status: RecordStatus.ACTIVE,
          deletedAt: null,
        },
        select: { id: true, branchId: true },
      });
      if (!department) {
        throw new BadRequestException(
          'Department does not belong to this facility or is not active',
        );
      }
      if (branchId && department.branchId && department.branchId !== branchId) {
        throw new BadRequestException(
          'Department does not belong to the selected branch',
        );
      }
    }

    if (dto.serviceId) {
      const service = await db.service.findFirst({
        where: {
          id: dto.serviceId,
          tenantId,
          status: RecordStatus.ACTIVE,
          deletedAt: null,
        },
        select: {
          id: true,
          branchId: true,
          departmentId: true,
          durationMin: true,
        },
      });

      if (!service) {
        throw new BadRequestException(
          'Service does not belong to this facility or is not active',
        );
      }

      if (branchId && service.branchId && service.branchId !== branchId) {
        throw new BadRequestException(
          'Service does not belong to the selected branch',
        );
      }

      if (
        departmentId &&
        service.departmentId &&
        service.departmentId !== departmentId
      ) {
        throw new BadRequestException(
          'Service does not belong to the selected department',
        );
      }

      if (
        service.durationMin &&
        Math.abs(
          new Date(dto.endAt).getTime() -
            new Date(dto.startAt).getTime() -
            service.durationMin * 60000,
        ) > 60000
      ) {
        throw new BadRequestException(
          'Appointment duration does not match the selected service duration',
        );
      }
    }
  }

  private async validateProviderAvailability(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: CreateAppointmentDto | CreatePatientAppointmentDto,
    branchId: string | null,
    departmentId: string | null,
    startAt: Date,
    endAt: Date,
    timeZone: string,
  ) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(startAt);

    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? '';

    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .indexOf(part('weekday'));
    const startMinute = Number(part('hour')) * 60 + Number(part('minute'));

    const endParts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(endAt);

    const endPart = (type: Intl.DateTimeFormatPartTypes) =>
      endParts.find((item) => item.type === type)?.value ?? '';

    const localStartDate = `${part('year')}-${part('month')}-${part('day')}`;
    const localEndDate =
      `${endPart('year')}-${endPart('month')}-${endPart('day')}`;

    if (
      localStartDate !== localEndDate ||
      weekday < 0 ||
      endAt.getTime() <= startAt.getTime()
    ) {
      throw new BadRequestException(
        'Appointments must fit within one local calendar day',
      );
    }

    const endMinute = Number(endPart('hour')) * 60 + Number(endPart('minute'));

    const rules = await tx.providerAvailability.findMany({
      where: {
        tenantId,
        providerId: dto.providerId!,
        isActive: true,
        // Filter by tenant/provider and active status here.
        // Day-of-week and effective dates are validated per rule time zone below.

        AND: [
          { OR: [{ branchId: null }, { branchId }] },
          { OR: [{ departmentId: null }, { departmentId }] },
          { OR: [{ serviceId: null }, { serviceId: dto.serviceId ?? null }] },
        ],
      },
    });

    const matchingRule = rules.find((rule) => {
      const ruleParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: rule.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(startAt);
      const getRulePart = (type: Intl.DateTimeFormatPartTypes) =>
        ruleParts.find((item) => item.type === type)?.value ?? '';
      const ruleDate =
        `${getRulePart('year')}-${getRulePart('month')}-${getRulePart('day')}`;
      const ruleWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        .indexOf(getRulePart('weekday'));
      const ruleStartMinute =
        Number(getRulePart('hour')) * 60 + Number(getRulePart('minute'));

      const endRuleParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: rule.timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(endAt);
      const endRuleMinute =
        Number(endRuleParts.find((item) => item.type === 'hour')?.value ?? '0') *
          60 +
        Number(endRuleParts.find((item) => item.type === 'minute')?.value ?? '0');

      const ruleEndDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: rule.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(endAt);

      const effectiveDate = (date: Date) =>
        `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

      const effectiveStart = effectiveDate(rule.effectiveFrom);
      const effectiveEnd = rule.effectiveTo
        ? effectiveDate(rule.effectiveTo)
        : null;

      return (
        ruleDate === ruleEndDate &&
        ruleWeekday === rule.dayOfWeek &&
        ruleDate >= effectiveStart &&
        (effectiveEnd === null || ruleDate <= effectiveEnd) &&
        ruleStartMinute >= rule.startMinute &&
        endRuleMinute <= rule.endMinute &&
        (rule.slotDurationMin == null ||
          durationMinutes(startAt, endAt) === rule.slotDurationMin)
      );
    });

    if (!matchingRule || endMinute <= startMinute) {
      throw new BadRequestException(
        'The selected provider has no matching availability for this time',
      );
    }

    const block = await tx.availabilityBlock.findFirst({
      where: {
        tenantId,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        AND: [
          { OR: [{ providerId: null }, { providerId: dto.providerId! }] },
          { OR: [{ branchId: null }, { branchId }] },
          { OR: [{ departmentId: null }, { departmentId }] },
          { OR: [{ serviceId: null }, { serviceId: dto.serviceId ?? null }] },
        ],
      },
      select: { id: true, reason: true },
    });

    if (block) {
      throw new ConflictException(
        block.reason || 'The requested time is blocked for scheduling',
      );
    }
  }
}

function durationMinutes(startAt: Date, endAt: Date): number {
  return (endAt.getTime() - startAt.getTime()) / 60000;
}
