import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantWebsiteStatus } from '@prisma/client';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { TenantSetupService } from '../tenant-setup/tenant-setup.service.js';
import type {
  CreateTenantWebsiteEnquiryDto,
  TenantWebsiteAppointmentDto,
  TenantWebsiteSlotSearchDto,
  UpdateTenantWebsiteDto,
  UpdateTenantWebsiteEnquiryDto,
} from './dto/tenant-website.dto.js';
import {
  parseTenantWebsiteContent,
  provisionTenantWebsite,
  structuredDataTypeForTenant,
  type TenantWebsiteContent,
} from './tenant-website.utils.js';

@Injectable()
export class TenantWebsitesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly appointments: AppointmentsService,
    private readonly tenantSetup: TenantSetupService,
  ) {}

  private async getOrProvision(tenantId: string, actorId: string) {
    const tenant = await this.database.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, code: true },
    });
    if (!tenant) throw new NotFoundException('Organization not found.');
    return this.database.client.$transaction((tx) =>
      provisionTenantWebsite(tx, tenant.id, tenant.name, tenant.code, actorId),
    );
  }

  async getAdminWebsite(userId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const website = await this.getOrProvision(context.tenantId, userId);
    const [tenant, branches, services, revisions] = await Promise.all([
      this.database.client.tenant.findUnique({
        where: { id: context.tenantId },
        select: {
          id: true,
          name: true,
          type: true,
          profile: {
            select: {
              description: true,
              country: true,
              county: true,
              subcounty: true,
              address: true,
              contactPhone: true,
              contactEmail: true,
            },
          },
          setup: { select: { status: true, readinessPercent: true } },
        },
      }),
      this.database.client.branch.findMany({
        where: { tenantId: context.tenantId, status: 'ACTIVE', deletedAt: null },
        select: {
          id: true,
          name: true,
          address: true,
          town: true,
          county: true,
          contactPhone: true,
          contactEmail: true,
          openingTime: true,
          closingTime: true,
          operatingDays: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.database.client.service.findMany({
        where: { tenantId: context.tenantId, status: 'ACTIVE', deletedAt: null },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          category: true,
          price: true,
          durationMin: true,
          branchId: true,
          departmentId: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.database.client.tenantWebsiteRevision.findMany({
        where: { websiteId: website.id },
        select: { id: true, revision: true, slug: true, createdAt: true, actorId: true },
        orderBy: { revision: 'desc' },
        take: 50,
      }),
    ]);

    if (!tenant) throw new NotFoundException('Organization not found.');
    const providers = await this.database.client.providerProfile.findMany({
      where: { tenantId: context.tenantId, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        professionalTitle: true,
        specialty: true,
        user: { select: { displayName: true } },
        availabilityRules: { where: { isActive: true }, select: { id: true }, take: 1 },
      },
      orderBy: { user: { displayName: 'asc' } },
    });
    return {
      website: {
        id: website.id,
        slug: website.slug,
        status: website.status,
        draftContent: {
          ...parseTenantWebsiteContent(website.draftContent, tenant.name),
          structuredDataType: structuredDataTypeForTenant(tenant.type),
        },
        publishedRevision: website.publishedRevision,
        revision: website.revision,
        publishedAt: website.publishedAt,
        updatedAt: website.updatedAt,
      },
      tenant,
      branches,
      services: services.map((service) => ({ ...service, price: service.price.toString() })),
      providers: providers.map(({ availabilityRules, ...provider }) => ({
        ...provider,
        hasAvailability: availabilityRules.length > 0,
      })),
      revisions,
      previewUrl: `/sites/${website.slug}?preview=1`,
      publicUrl: website.status === TenantWebsiteStatus.PUBLISHED ? `/sites/${website.slug}` : null,
      launchReadiness: tenant.setup,
    };
  }

  async getWebsiteStatus(userId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'read',
    });
    const website = await this.getOrProvision(context.tenantId, userId);
    return {
      status: website.status,
      slug: website.slug,
      revision: website.revision,
      updatedAt: website.updatedAt,
      publicUrl: website.status === TenantWebsiteStatus.PUBLISHED ? `/sites/${website.slug}` : null,
      previewUrl: `/sites/${website.slug}?preview=1`,
    };
  }

  async updateDraft(userId: string, dto: UpdateTenantWebsiteDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const current = await this.getOrProvision(context.tenantId, userId);
    const tenant = await this.database.client.tenant.findUniqueOrThrow({
      where: { id: context.tenantId },
      select: { name: true, type: true },
    });
    const currentContent = parseTenantWebsiteContent(current.draftContent, tenant.name);
    const nextContent = { ...currentContent } as TenantWebsiteContent;
    for (const [key, value] of Object.entries(dto)) {
      if (key !== 'slug' && value !== undefined) {
        (nextContent as unknown as Record<string, unknown>)[key] = value;
      }
    }
    nextContent.structuredDataType = structuredDataTypeForTenant(tenant.type);
    await this.validateSelections(context.tenantId, nextContent);
    this.validateImageUrls(nextContent);

    const nextRevision = current.revision + 1;
    const slug = dto.slug?.trim() ?? current.slug;
    try {
      await this.database.client.$transaction(async (tx) => {
        const updated = await tx.tenantWebsite.update({
          where: { id: current.id, tenantId: context.tenantId },
          data: {
            slug,
            draftContent: nextContent as unknown as Prisma.InputJsonObject,
            revision: nextRevision,
          },
        });
        await tx.tenantWebsiteRevision.create({
          data: {
            websiteId: updated.id,
            revision: nextRevision,
            slug: updated.slug,
            content: nextContent as unknown as Prisma.InputJsonObject,
            actorId: userId,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            action: 'TENANT_WEBSITE_DRAFT_UPDATED',
            resourceType: 'TENANT_WEBSITE',
            resourceId: updated.id,
            outcome: 'SUCCESS',
            metadata: { revision: nextRevision, slug: updated.slug },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That website URL is already in use.');
      }
      throw error;
    }
    return this.getAdminWebsite(userId);
  }

  async publish(userId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const readiness = await this.tenantSetup.getSetup(userId);
    const incomplete = readiness.requirements
      .filter((item) => item.required && !item.complete)
      .map((item) => item.label);
    if (incomplete.length > 0 || !['READY', 'LIVE'].includes(readiness.setup.status)) {
      const blockers = incomplete.length > 0
        ? incomplete
        : readiness.requirements.filter((item) => !item.complete).map((item) => item.label);
      throw new ConflictException({
        message: 'Website publishing requires completed launch checks and live organization status.',
        incompleteRequirements: blockers,
      });
    }

    const current = await this.getOrProvision(context.tenantId, userId);
    const tenant = await this.database.client.tenant.findUniqueOrThrow({
      where: { id: context.tenantId },
      select: { name: true, type: true },
    });
    const content = parseTenantWebsiteContent(current.draftContent, tenant.name);
    content.structuredDataType = structuredDataTypeForTenant(tenant.type);
    if (content.branchIds.length === 0 || content.serviceIds.length === 0) {
      throw new ConflictException({
        message: 'Select at least one active branch and service for the public website.',
        incompleteRequirements: ['Public branch selection', 'Public service selection'],
      });
    }
    await this.validateSelections(context.tenantId, content);
    await this.database.client.$transaction(async (tx) => {
      await tx.tenantWebsite.update({
        where: { id: current.id, tenantId: context.tenantId },
        data: {
          status: TenantWebsiteStatus.PUBLISHED,
          publishedContent: content as unknown as Prisma.InputJsonObject,
          publishedRevision: current.revision,
          publishedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: userId,
          action: 'TENANT_WEBSITE_PUBLISHED',
          resourceType: 'TENANT_WEBSITE',
          resourceId: current.id,
          outcome: 'SUCCESS',
          metadata: { revision: current.revision, slug: current.slug },
        },
      });
    });
    return this.getAdminWebsite(userId);
  }

  async unpublish(userId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const current = await this.getOrProvision(context.tenantId, userId);
    await this.database.client.$transaction(async (tx) => {
      await tx.tenantWebsite.update({
        where: { id: current.id, tenantId: context.tenantId },
        data: { status: TenantWebsiteStatus.UNPUBLISHED },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: userId,
          action: 'TENANT_WEBSITE_UNPUBLISHED',
          resourceType: 'TENANT_WEBSITE',
          resourceId: current.id,
          outcome: 'SUCCESS',
        },
      });
    });
    return this.getAdminWebsite(userId);
  }

  async restoreRevision(userId: string, revisionId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const website = await this.getOrProvision(context.tenantId, userId);
    const revision = await this.database.client.tenantWebsiteRevision.findFirst({
      where: { id: revisionId, websiteId: website.id },
    });
    if (!revision) throw new NotFoundException('Website revision not found.');
    const nextRevision = website.revision + 1;
    try {
      await this.database.client.$transaction(async (tx) => {
        const restored = await tx.tenantWebsite.update({
          where: { id: website.id, tenantId: context.tenantId },
          data: {
            slug: revision.slug,
            draftContent: revision.content as Prisma.InputJsonObject,
            revision: nextRevision,
          },
        });
        await tx.tenantWebsiteRevision.create({
          data: {
            websiteId: restored.id,
            revision: nextRevision,
            slug: restored.slug,
            content: revision.content as Prisma.InputJsonObject,
            actorId: userId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This historical website URL is now owned by another organization.');
      }
      throw error;
    }
    return this.getAdminWebsite(userId);
  }

  async getPublicWebsite(slug: string) {
    const website = await this.database.client.tenantWebsite.findFirst({
      where: {
        slug,
        status: TenantWebsiteStatus.PUBLISHED,
        tenant: {
          is: {
            status: 'ACTIVE',
            deletedAt: null,
            setup: { is: { status: { in: ['READY', 'LIVE'] } } },
          },
        },
      },
      select: {
        slug: true,
        publishedContent: true,
        tenant: {
          select: {
            id: true,
            name: true,
            type: true,
            setup: { select: { status: true } },
            bookingPolicy: { select: { allowOnlineBooking: true } },
            profile: {
              select: {
                description: true,
                country: true,
                county: true,
                subcounty: true,
                address: true,
                contactPhone: true,
                contactEmail: true,
              },
            },
            branches: {
              where: { status: 'ACTIVE', deletedAt: null },
              select: {
                id: true,
                name: true,
                address: true,
                town: true,
                county: true,
                contactPhone: true,
                contactEmail: true,
                openingTime: true,
                closingTime: true,
                operatingDays: true,
              },
              orderBy: { name: 'asc' },
            },
            services: {
              where: { status: 'ACTIVE', deletedAt: null },
              select: {
                id: true,
                name: true,
                description: true,
                category: true,
                price: true,
                durationMin: true,
                branchId: true,
                departmentId: true,
              },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    });
    if (!website?.publishedContent) throw new NotFoundException('Website not found.');
    const content = parseTenantWebsiteContent(website.publishedContent, website.tenant.name);
    const branchIds = new Set(content.branchIds);
    const serviceIds = new Set(content.serviceIds);
    const branches = website.tenant.branches.filter((branch) => branchIds.has(branch.id));
    const activeBranchIds = new Set(branches.map((branch) => branch.id));
    const services = website.tenant.services
      .filter((service) => serviceIds.has(service.id))
      .filter((service) => !service.branchId || activeBranchIds.has(service.branchId))
      .map((service) => ({ ...service, price: service.price.toString() }));
    const providers = await this.database.client.providerProfile.findMany({
      where: {
        tenantId: website.tenant.id,
        id: { in: content.providerIds },
        status: 'ACTIVE',
        deletedAt: null,
        availabilityRules: { some: { isActive: true } },
      },
      select: {
        id: true,
        professionalTitle: true,
        specialty: true,
        user: { select: { displayName: true } },
      },
      orderBy: { user: { displayName: 'asc' } },
    });

    return {
      slug: website.slug,
      organization: {
        name: website.tenant.name,
        type: website.tenant.type,
        description: content.description || website.tenant.profile?.description || '',
        address: website.tenant.profile?.address,
        town: website.tenant.profile?.subcounty,
        county: website.tenant.profile?.county,
        country: website.tenant.profile?.country,
        contactPhone: content.contactPhone || website.tenant.profile?.contactPhone || null,
        contactEmail: content.contactEmail || website.tenant.profile?.contactEmail || null,
      },
      content: {
        ...content,
        structuredDataType: structuredDataTypeForTenant(website.tenant.type),
        branchIds: undefined,
        serviceIds: undefined,
        providerIds: undefined,
      },
      branches,
      services,
      providers,
      bookingAvailable:
        website.tenant.setup?.status === 'LIVE' &&
        website.tenant.bookingPolicy?.allowOnlineBooking === true &&
        services.length > 0 &&
        providers.length > 0,
    };
  }

  async createEnquiry(slug: string, dto: CreateTenantWebsiteEnquiryDto) {
    if (dto.website?.trim()) throw new BadRequestException('Unable to accept this enquiry.');
    const website = await this.database.client.tenantWebsite.findFirst({
      where: {
        slug,
        status: TenantWebsiteStatus.PUBLISHED,
        tenant: { is: { status: 'ACTIVE', deletedAt: null, setup: { is: { status: { in: ['READY', 'LIVE'] } } } } },
      },
      select: { id: true, tenantId: true },
    });
    if (!website) throw new NotFoundException('Website not found.');
    const enquiry = await this.database.client.tenantWebsiteEnquiry.create({
      data: {
        websiteId: website.id,
        tenantId: website.tenantId,
        name: dto.name.trim(),
        email: dto.email?.trim().toLowerCase() ?? null,
        phone: dto.phone?.trim() ?? null,
        message: dto.message.trim(),
      },
      select: { id: true },
    });
    return { accepted: true, reference: enquiry.id };
  }

  async listEnquiries(userId: string) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const website = await this.getOrProvision(context.tenantId, userId);
    return this.database.client.tenantWebsiteEnquiry.findMany({
      where: { websiteId: website.id, tenantId: context.tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        message: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateEnquiry(userId: string, enquiryId: string, dto: UpdateTenantWebsiteEnquiryDto) {
    const context = await this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
    const website = await this.getOrProvision(context.tenantId, userId);
    const updated = await this.database.client.tenantWebsiteEnquiry.updateMany({
      where: { id: enquiryId, websiteId: website.id, tenantId: context.tenantId },
      data: { status: dto.status },
    });
    if (!updated.count) throw new NotFoundException('Website enquiry not found.');
    return { updated: true };
  }

  async discoverSlots(slug: string, dto: TenantWebsiteSlotSearchDto) {
    const website = await this.getPublishedWebsiteForBooking(slug, dto.serviceId, dto.branchId);
    const content = parseTenantWebsiteContent(website.publishedContent!, website.tenant.name);
    const publishedBranchIds = new Set(content.branchIds);
    const publishedProviderIds = new Set(content.providerIds);
    const slots = await this.appointments.discoverSlots({ ...dto, tenantId: website.tenantId });
    return slots.filter(
      (slot) =>
        publishedProviderIds.has(slot.providerId) &&
        (!slot.branchId || publishedBranchIds.has(slot.branchId)),
    );
  }

  async createAppointment(userId: string, slug: string, dto: TenantWebsiteAppointmentDto) {
    await this.getPublishedWebsiteForBooking(slug, dto.serviceId, dto.branchId);
    throw new ConflictException({
      message: 'Online bookings require patient eligibility verification and the KSh 100 deposit workflow.',
      bookingRoute: '/patient/appointments',
    });
  }

  private async getPublishedWebsiteForBooking(slug: string, serviceId: string, branchId?: string) {
    const website = await this.database.client.tenantWebsite.findFirst({
      where: {
        slug,
        status: TenantWebsiteStatus.PUBLISHED,
        tenant: {
          is: {
            status: 'ACTIVE',
            deletedAt: null,
            setup: { is: { status: 'LIVE' } },
            bookingPolicy: { is: { allowOnlineBooking: true } },
          },
        },
      },
      select: {
        id: true,
        tenantId: true,
        publishedContent: true,
        tenant: { select: { name: true } },
      },
    });
    if (!website?.publishedContent) throw new NotFoundException('Website not found.');
    const content = parseTenantWebsiteContent(website.publishedContent, website.tenant.name);
    if (!content.serviceIds.includes(serviceId)) {
      throw new NotFoundException('This service is not offered on the public website.');
    }
    if (branchId && !content.branchIds.includes(branchId)) {
      throw new NotFoundException('This branch is not offered on the public website.');
    }
    return website;
  }

  private async validateSelections(tenantId: string, content: TenantWebsiteContent) {
    const [branchCount, serviceCount, providerCount] = await Promise.all([
      this.database.client.branch.count({
        where: {
          tenantId,
          id: { in: content.branchIds },
          status: 'ACTIVE',
          deletedAt: null,
        },
      }),
      this.database.client.service.count({
        where: {
          tenantId,
          id: { in: content.serviceIds },
          status: 'ACTIVE',
          deletedAt: null,
          OR: [
            { branchId: null },
            { branchId: { in: content.branchIds } },
          ],
        },
      }),
      this.database.client.providerProfile.count({
        where: {
          tenantId,
          id: { in: content.providerIds },
          status: 'ACTIVE',
          deletedAt: null,
        },
      }),
    ]);
    if (
      branchCount !== content.branchIds.length ||
      (content.branchIds.length > 0 && branchCount < content.branchIds.length)
    ) {
      throw new BadRequestException('Select only active branches owned by this organization.');
    }
    if (serviceCount !== content.serviceIds.length) {
      throw new BadRequestException('Select only active services available at selected branches.');
    }
    if (providerCount !== content.providerIds.length) {
      throw new BadRequestException('Select only active providers owned by this organization.');
    }
  }

  private validateImageUrls(content: TenantWebsiteContent) {
    for (const url of [content.logoUrl, content.heroImageUrl, content.socialShareImageUrl, content.faviconUrl, ...content.gallery.map((image) => image.url)]) {
      if (url && !/^https:\/\//i.test(url)) {
        throw new BadRequestException('Website images must use secure HTTPS URLs.');
      }
    }
  }
}