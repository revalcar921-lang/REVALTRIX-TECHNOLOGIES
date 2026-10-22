import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProviderType, RecordStatus } from '@prisma/client';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { CreateProviderDto } from './dto/create-provider.dto.js';
import { CreateProviderAvailabilityDto } from './dto/create-provider-availability.dto.js';
import { ProviderQueryDto } from './dto/provider-query.dto.js';
import { UpdateProviderDto } from './dto/update-provider.dto.js';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(userId: string, query: ProviderQueryDto) {
    const context = await this.authorization.getContext(userId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const search = query.search?.trim();

    const where: Prisma.ProviderProfileWhereInput = {
      tenantId: context.tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : { status: RecordStatus.ACTIVE }),
      ...(query.providerType ? { providerType: query.providerType } : {}),
      ...(search
        ? {
            OR: [
              {
                providerNumber: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                professionalTitle: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                specialty: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                subspecialty: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                user: {
                  displayName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, providers] = await Promise.all([
      this.database.client.providerProfile.count({ where }),
      this.database.client.providerProfile.findMany({
        where,
        orderBy: [
          { user: { displayName: 'asc' } },
          { providerNumber: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: this.providerSelect(),
      }),
    ]);

    return {
      items: providers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async listEligibleUsers(userId: string) {
    const context = await this.authorization.getContext(userId);
    const now = new Date();
    const staffProfiles = await this.database.client.staffProfile.findMany({
      where: {
        tenantId: context.tenantId,
        status: RecordStatus.ACTIVE,
        professionalCategory: { not: null },
        user: {
          is: {
            status: RecordStatus.ACTIVE,
            deletedAt: null,
            memberships: {
              some: {
                tenantId: context.tenantId,
                status: 'ACTIVE',
                startsAt: { lte: now },
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              },
            },
            providerProfiles: {
              none: { tenantId: context.tenantId },
            },
          },
        },
      },
      select: {
        id: true,
        staffNumber: true,
        professionalCategory: true,
        jobTitle: true,
        specialty: true,
        licenseNumber: true,
        branchId: true,
        departmentId: true,
        user: { select: { id: true, displayName: true, username: true } },
        services: { select: { serviceId: true } },
        shifts: {
          where: { status: 'ACTIVE' },
          select: { startTime: true, endTime: true, daysOfWeek: true, branchId: true, departmentId: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return staffProfiles.map(({ services, ...profile }) => ({
      ...profile,
      serviceIds: services.map(({ serviceId }) => serviceId),
    }));
  }

  async getById(userId: string, providerId: string) {
    const context = await this.authorization.getContext(userId);

    const provider = await this.database.client.providerProfile.findFirst({
      where: {
        id: providerId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      select: this.providerSelect(),
    });

    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    return provider;
  }

  async listAvailability(userId: string, providerId: string) {
    const context = await this.authorization.getContext(userId);
    const provider = await this.database.client.providerProfile.findFirst({
      where: { id: providerId, tenantId: context.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw new NotFoundException('Provider not found');
    return this.database.client.providerAvailability.findMany({
      where: { tenantId: context.tenantId, providerId, isActive: true },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async createAvailability(
    userId: string,
    providerId: string,
    dto: CreateProviderAvailabilityDto,
  ) {
    const context = await this.authorization.getContext(userId);
    const provider = await this.database.client.providerProfile.findFirst({
      where: { id: providerId, tenantId: context.tenantId, status: RecordStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw new NotFoundException('Active provider not found');
    if (dto.endMinute <= dto.startMinute) {
      throw new BadRequestException('Availability end time must be after its start time');
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: dto.timeZone }).format(new Date());
    } catch {
      throw new BadRequestException('Enter a valid IANA time zone');
    }
    const effectiveFrom = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    const effectiveTo = dto.effectiveTo
      ? new Date(`${dto.effectiveTo}T00:00:00.000Z`)
      : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('Availability end date must not be before its start date');
    }

    const [branch, department, service] = await Promise.all([
      this.database.client.branch.findFirst({
        where: { id: dto.branchId, tenantId: context.tenantId, status: RecordStatus.ACTIVE, deletedAt: null },
        select: { id: true },
      }),
      this.database.client.department.findFirst({
        where: { id: dto.departmentId, tenantId: context.tenantId, status: RecordStatus.ACTIVE, deletedAt: null },
        select: { id: true, branchId: true },
      }),
      this.database.client.service.findFirst({
        where: { id: dto.serviceId, tenantId: context.tenantId, status: RecordStatus.ACTIVE, deletedAt: null },
        select: { id: true, branchId: true, departmentId: true },
      }),
    ]);
    if (!branch) throw new BadRequestException('Select an active branch in this organization');
    if (!department || (department.branchId && department.branchId !== branch.id)) {
      throw new BadRequestException('Select a department available at the selected branch');
    }
    if (!service || (service.branchId && service.branchId !== branch.id) ||
      (service.departmentId && service.departmentId !== department.id)) {
      throw new BadRequestException('Select a service available to the selected department and branch');
    }

    return this.database.client.providerAvailability.create({
      data: {
        tenantId: context.tenantId,
        providerId,
        branchId: branch.id,
        departmentId: department.id,
        serviceId: service.id,
        dayOfWeek: dto.dayOfWeek,
        startMinute: dto.startMinute,
        endMinute: dto.endMinute,
        timeZone: dto.timeZone,
        effectiveFrom,
        effectiveTo,
        createdByUserId: userId,
      },
      include: {
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
    });
  }

  async deactivateAvailability(userId: string, providerId: string, availabilityId: string) {
    const context = await this.authorization.getContext(userId);
    const result = await this.database.client.providerAvailability.updateMany({
      where: {
        id: availabilityId,
        providerId,
        tenantId: context.tenantId,
        isActive: true,
      },
      data: { isActive: false },
    });
    if (!result.count) throw new NotFoundException('Active availability rule not found');
    return { id: availabilityId, isActive: false };
  }

  async create(userId: string, dto: CreateProviderDto) {
    const context = await this.authorization.getContext(userId);

    const providerNumber = dto.providerNumber.trim();

    if (!providerNumber) {
      throw new BadRequestException('Provider number is required');
    }

    const existingUser = await this.database.client.user.findFirst({
      where: {
        id: dto.userId,
        status: RecordStatus.ACTIVE,
        deletedAt: null,
        memberships: {
          some: {
            tenantId: context.tenantId,
            status: 'ACTIVE',
            startsAt: { lte: new Date() },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
        },
      },
      select: {
        id: true,
        displayName: true,
      },
    });

    if (!existingUser) {
      throw new BadRequestException(
        'Provider user must be an active user with an active membership in this tenant',
      );
    }

    const existingProvider = await this.database.client.providerProfile.findFirst({
      where: {
        tenantId: context.tenantId,
        OR: [
          { userId: dto.userId },
          { providerNumber },
        ],
        deletedAt: null,
      },
      select: { id: true, userId: true, providerNumber: true },
    });

    if (existingProvider) {
      if (existingProvider.userId === dto.userId) {
        throw new ConflictException(
          'This user already has a provider profile in this tenant',
        );
      }

      throw new ConflictException(
        'Provider number is already in use in this tenant',
      );
    }

    try {
      const provider = await this.database.client.$transaction(async (transaction) => {
        const created = await transaction.providerProfile.create({
          data: {
            tenantId: context.tenantId,
            userId: dto.userId,
            providerNumber,
            providerType: dto.providerType,
            professionalTitle: dto.professionalTitle?.trim() || null,
            specialty: dto.specialty?.trim() || null,
            subspecialty: dto.subspecialty?.trim() || null,
            registrationNumber: dto.registrationNumber?.trim() || null,
            registrationBody: dto.registrationBody?.trim() || null,
            licenseNumber: dto.licenseNumber?.trim() || null,
            licenseExpiryDate: dto.licenseExpiryDate
              ? new Date(dto.licenseExpiryDate)
              : null,
          },
          select: this.providerSelect(),
        });

        await transaction.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: context.branchId,
            action: 'PROVIDER_CREATED',
            resourceType: 'PROVIDER_PROFILE',
            resourceId: created.id,
            outcome: 'SUCCESS',
            reason: 'Provider profile created',
            metadata: {
              providerUserId: dto.userId,
              providerNumber: created.providerNumber,
              providerType: created.providerType,
            },
          },
        });

        return created;
      });

      return provider;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Provider number or provider profile already exists in this tenant',
        );
      }

      throw error;
    }
  }

  async update(userId: string, providerId: string, dto: UpdateProviderDto) {
    const context = await this.authorization.getContext(userId);

    const existing = await this.database.client.providerProfile.findFirst({
      where: {
        id: providerId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        providerNumber: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Provider not found');
    }

    const providerNumber = dto.providerNumber?.trim();

    if (dto.providerNumber !== undefined && !providerNumber) {
      throw new BadRequestException('Provider number cannot be empty');
    }

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const updated = await transaction.providerProfile.update({
          where: { id: providerId },
          data: {
            ...(providerNumber !== undefined
              ? { providerNumber }
              : {}),
            ...(dto.providerType !== undefined
              ? { providerType: dto.providerType }
              : {}),
            ...(dto.professionalTitle !== undefined
              ? { professionalTitle: dto.professionalTitle.trim() || null }
              : {}),
            ...(dto.specialty !== undefined
              ? { specialty: dto.specialty.trim() || null }
              : {}),
            ...(dto.subspecialty !== undefined
              ? { subspecialty: dto.subspecialty.trim() || null }
              : {}),
            ...(dto.registrationNumber !== undefined
              ? { registrationNumber: dto.registrationNumber.trim() || null }
              : {}),
            ...(dto.registrationBody !== undefined
              ? { registrationBody: dto.registrationBody.trim() || null }
              : {}),
            ...(dto.licenseNumber !== undefined
              ? { licenseNumber: dto.licenseNumber.trim() || null }
              : {}),
            ...(dto.licenseExpiryDate !== undefined
              ? { licenseExpiryDate: new Date(dto.licenseExpiryDate) }
              : {}),
            ...(dto.status !== undefined
              ? { status: dto.status }
              : {}),
            ...(dto.status === RecordStatus.ACTIVE
              ? { deletedAt: null }
              : {}),
          },
          select: this.providerSelect(),
        });

        await transaction.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: context.branchId,
            action: 'PROVIDER_UPDATED',
            resourceType: 'PROVIDER_PROFILE',
            resourceId: providerId,
            outcome: 'SUCCESS',
            reason: 'Provider profile updated',
            metadata: {
              previousStatus: existing.status,
              newStatus: updated.status,
            },
          },
        });

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Provider number is already in use in this tenant',
        );
      }

      throw error;
    }
  }

  async remove(userId: string, providerId: string) {
    const context = await this.authorization.getContext(userId);

    const existing = await this.database.client.providerProfile.findFirst({
      where: {
        id: providerId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Provider not found');
    }

    return this.database.client.$transaction(async (transaction) => {
      const updated = await transaction.providerProfile.update({
        where: { id: providerId },
        data: {
          status: RecordStatus.INACTIVE,
          deletedAt: new Date(),
        },
        select: this.providerSelect(),
      });

      await transaction.auditEvent.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: userId,
          branchId: context.branchId,
          action: 'PROVIDER_DEACTIVATED',
          resourceType: 'PROVIDER_PROFILE',
          resourceId: providerId,
          outcome: 'SUCCESS',
          reason: 'Provider profile deactivated',
          metadata: {
            previousStatus: existing.status,
            newStatus: RecordStatus.INACTIVE,
          },
        },
      });

      return updated;
    });
  }

  private providerSelect() {
    return {
      id: true,
      providerNumber: true,
      providerType: true,
      professionalTitle: true,
      specialty: true,
      subspecialty: true,
      registrationNumber: true,
      registrationBody: true,
      licenseNumber: true,
      licenseExpiryDate: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          displayName: true,
          username: true,
          status: true,
        },
      },
    } satisfies Prisma.ProviderProfileSelect;
  }
}
