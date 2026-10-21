import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import {
  Prisma,
  TenantSetupStatus,
  TenantType,
  type BookingPolicy,
  type OrganizationCompliance,
  type OrganizationPaymentConfig,
  type ReadinessTestRun,
} from '@prisma/client';
import { AuthorizationService } from '../authorization/authorization.service.js';
import type {
  AcceptTenantTermsDto,
  CreateOperationalResourceDto,
  UpdateBookingPolicyDto,
  UpdateOrganizationPaymentConfigDto,
  UploadTenantDocumentDto,
} from './dto/tenant-setup-config.dto.js';

export interface ReadinessRequirement {
  key: string;
  label: string;
  reason?: string;
  status?: 'INCOMPLETE' | 'PENDING_REVIEW' | 'COMPLETE' | 'BLOCKED';
  progress?: number;
  missing?: string[];
  ctaLabel?: string;
  ctaRoute?: string;
  weight: number;
  required: boolean;
  available: boolean;
  complete: boolean;
}

@Injectable()
export class TenantSetupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async getTenantSettings(userId: string) {
    const membership = await this.database.client.membership.findFirst({
      where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      select: { tenantId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('Active tenant membership not found.');
    const [bookingPolicy, paymentConfig, resources, compliance, latestTestRun, documents] = await Promise.all([
      this.database.client.bookingPolicy.findUnique({ where: { tenantId: membership.tenantId } }),
      this.database.client.organizationPaymentConfig.findUnique({ where: { tenantId: membership.tenantId } }),
      this.database.client.operationalResource.findMany({
        where: { tenantId: membership.tenantId },
        select: { id: true, branchId: true, name: true, type: true, capacity: true, isActive: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.database.client.organizationCompliance.findUnique({
        where: { tenantId: membership.tenantId },
        select: { termsVersion: true, termsAcceptedAt: true, termsAcceptedByUserId: true, ownerIdentityStatus: true },
      }),
      this.database.client.readinessTestRun.findFirst({
        where: { tenantId: membership.tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      this.database.client.tenantDocument.findMany({
        where: { tenantId: membership.tenantId, status: { notIn: ['DRAFT', 'REPLACED'] } },
        select: {
          id: true,
          type: true,
          title: true,
          documentNumber: true,
          issuingAuthority: true,
          issueDate: true,
          expiryDate: true,
          status: true,
          verificationStatus: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      bookingPolicy,
      paymentConfig,
      resources,
      compliance,
      latestTestRun,
      documents,
      currentTermsVersion: process.env.REVALTRIX_TERMS_VERSION ?? null,
      termsUrl: process.env.REVALTRIX_TERMS_URL ?? null,
    };
  }

  async updateBookingPolicy(userId: string, dto: UpdateBookingPolicyDto) {
    const context = await this.assertTenantUpdate(userId);
    return this.database.client.bookingPolicy.upsert({
      where: { tenantId: context.tenantId },
      create: { tenantId: context.tenantId, ...dto },
      update: dto,
    });
  }

  async updatePaymentConfig(userId: string, dto: UpdateOrganizationPaymentConfigDto) {
    const context = await this.assertTenantUpdate(userId);
    if (!dto.acceptCash && !dto.acceptMpesa && !dto.acceptCard && !dto.acceptBankTransfer) {
      throw new ConflictException('Enable at least one payment preference.');
    }
    if (dto.depositRequired && dto.depositPercent === undefined) {
      throw new ConflictException('A deposit percentage is required when deposits are enabled.');
    }
    if (dto.acceptMpesa && !dto.mpesaPaybill?.trim()) {
      throw new ConflictException('Enter the M-Pesa paybill before enabling M-Pesa as a payment option.');
    }
    if (dto.acceptBankTransfer && (!dto.bankAccountName?.trim() || !dto.bankAccountNumber?.trim())) {
      throw new ConflictException('Enter the bank account name and number before enabling bank transfer.');
    }
    return this.database.client.organizationPaymentConfig.upsert({
      where: { tenantId: context.tenantId },
      create: { tenantId: context.tenantId, ...dto },
      update: dto,
    });
  }

  async createOperationalResource(userId: string, dto: CreateOperationalResourceDto) {
    const context = await this.assertTenantUpdate(userId);
    if (dto.branchId) {
      const branch = await this.database.client.branch.findFirst({
        where: { id: dto.branchId, tenantId: context.tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new ConflictException('Select an active branch owned by this organization.');
    }
    return this.database.client.operationalResource.create({
      data: { tenantId: context.tenantId, ...dto, name: dto.name.trim() },
    });
  }

  async uploadTenantDocument(
    userId: string,
    dto: UploadTenantDocumentDto,
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    const context = await this.assertTenantUpdate(userId);
    if (!file || file.buffer.length === 0 || file.buffer.length > 10 * 1024 * 1024 || file.size !== file.buffer.length) {
      throw new ConflictException('Choose a PDF, JPG, or PNG document no larger than 10 MB.');
    }
    const extensionByType: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
    };
    const extension = extensionByType[file.mimetype];
    const validSignature = file.mimetype === 'application/pdf'
      ? file.buffer.subarray(0, 5).toString() === '%PDF-'
      : file.mimetype === 'image/jpeg'
        ? file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff
        : file.mimetype === 'image/png'
          ? file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : false;
    if (!extension || !validSignature) throw new ConflictException('The document file type or content is invalid.');

    const storageKey = `tenant/${context.tenantId}/compliance/${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    try {
      return await this.database.client.$transaction(async (tx) => {
        const document = await tx.tenantDocument.create({
          data: {
            tenantId: context.tenantId,
            type: dto.type,
            status: 'UPLOADED',
            verificationStatus: 'PENDING',
            title: dto.title.trim(),
            documentNumber: dto.documentNumber?.trim() || null,
            issuingAuthority: dto.issuingAuthority?.trim() || null,
            issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
            storageKey,
            fileName: file.originalname.replace(/[\r\n"\\/]/g, '_').slice(0, 255),
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            uploadedByUserId: userId,
          },
          select: { id: true, type: true, title: true, status: true, verificationStatus: true, createdAt: true },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            action: 'TENANT_COMPLIANCE_DOCUMENT_UPLOADED',
            resourceType: 'TENANT_DOCUMENT',
            resourceId: document.id,
            outcome: 'SUCCESS',
            metadata: { type: dto.type, status: document.status },
          },
        });
        return document;
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async acceptTerms(userId: string, dto: AcceptTenantTermsDto, ipAddress?: string) {
    if (!dto.accepted) throw new ConflictException('Terms must be explicitly accepted.');
    const currentTermsVersion = process.env.REVALTRIX_TERMS_VERSION?.trim();
    const termsUrl = process.env.REVALTRIX_TERMS_URL?.trim();
    if (!currentTermsVersion || !termsUrl) {
      throw new ConflictException('The platform has not configured a current terms version and policy URL.');
    }
    if (dto.version.trim() !== currentTermsVersion) {
      throw new ConflictException('Accept the current platform terms version.');
    }
    const context = await this.assertTenantUpdate(userId);
    const acceptedAt = new Date();
    const result = await this.database.client.$transaction(async (tx) => {
      const compliance = await tx.organizationCompliance.upsert({
        where: { tenantId: context.tenantId },
        create: {
          tenantId: context.tenantId,
          termsVersion: dto.version.trim(),
          termsAcceptedAt: acceptedAt,
          termsAcceptedByUserId: userId,
          termsAcceptanceIp: ipAddress?.slice(0, 64) ?? null,
        },
        update: {
          termsVersion: dto.version.trim(),
          termsAcceptedAt: acceptedAt,
          termsAcceptedByUserId: userId,
          termsAcceptanceIp: ipAddress?.slice(0, 64) ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: userId,
          action: 'TENANT_TERMS_ACCEPTED',
          resourceType: 'ORGANIZATION_COMPLIANCE',
          resourceId: compliance.id,
          outcome: 'SUCCESS',
          metadata: { version: dto.version.trim() },
        },
      });
      return compliance;
    });
    return { accepted: true, version: result.termsVersion, acceptedAt: result.termsAcceptedAt };
  }

  private assertTenantUpdate(userId: string) {
    return this.authorization.assertPermission(userId, {
      resource: 'organization',
      action: 'update',
    });
  }

  async getSetup(userId: string) {
    const membership = await this.database.client.membership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        tenant: {
          status: 'ACTIVE',
        },
      },
      select: {
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            legalName: true,
            type: true,
            status: true,
            profile: true,
            setup: true,
            website: { select: { slug: true, draftContent: true } },
            _count: {
              select: {
                branches: true,
                departments: true,
                memberships: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!membership) {
      throw new NotFoundException('Active tenant membership not found');
    }

    const [
      serviceCount,
      configuredServiceCount,
      activeServices,
      providerCount,
      administratorCount,
      branchCount,
      configuredBranchCount,
      activeBranches,
      activeDepartmentCount,
      documents,
    ] =
      await Promise.all([
        this.database.client.service.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        }),
        this.database.client.service.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
            price: { gt: 0 },
            durationMin: { gt: 0 },
          },
        }),
        this.database.client.service.findMany({
          where: { tenantId: membership.tenantId, status: 'ACTIVE', deletedAt: null },
          select: { price: true, durationMin: true },
        }),
        this.database.client.providerProfile.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        }),
        this.database.client.membership.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            startsAt: {
              lte: new Date(),
            },
            OR: [
              {
                endsAt: null,
              },
              {
                endsAt: {
                  gt: new Date(),
                },
              },
            ],
            roles: {
              some: {
                role: {
                  code: 'TENANT_ADMIN',
                  status: 'ACTIVE',
                },
              },
            },
          },
        }),
        this.database.client.branch.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        }),
        this.database.client.branch.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
            AND: [
              { address: { not: null } },
              { address: { not: '' } },
              { contactPhone: { not: null } },
              { contactPhone: { not: '' } },
              { contactEmail: { not: null } },
              { contactEmail: { not: '' } },
              { openingTime: { not: null } },
              { closingTime: { not: null } },
              { operatingDays: { isEmpty: false } },
            ],
          },
        }),
        this.database.client.branch.findMany({
          where: { tenantId: membership.tenantId, status: 'ACTIVE', deletedAt: null },
          select: {
            address: true,
            contactPhone: true,
            contactEmail: true,
            openingTime: true,
            closingTime: true,
            operatingDays: true,
          },
        }),
        this.database.client.department.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        }),
        this.database.client.tenantDocument.findMany({
          where: {
            tenantId: membership.tenantId,
            status: { notIn: ['DRAFT', 'REPLACED'] },
          },
          select: {
            type: true,
            status: true,
            verificationStatus: true,
            expiryDate: true,
            storageKey: true,
          },
        }),
      ]);

    const [bookingPolicy, paymentConfig, resourceCount, compliance, latestTestRun] =
      await Promise.all([
        this.database.client.bookingPolicy.findUnique({ where: { tenantId: membership.tenantId } }),
        this.database.client.organizationPaymentConfig.findUnique({ where: { tenantId: membership.tenantId } }),
        this.database.client.operationalResource.count({
          where: { tenantId: membership.tenantId, isActive: true },
        }),
        this.database.client.organizationCompliance.findUnique({
          where: { tenantId: membership.tenantId },
          select: {
            ownerIdentityStatus: true,
            termsVersion: true,
            termsAcceptedAt: true,
            termsAcceptedByUserId: true,
          },
        }),
        this.database.client.readinessTestRun.findFirst({
          where: { tenantId: membership.tenantId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    const [availabilityCount, serviceProviderLinkCount, verifiedAdministratorCount] =
      await Promise.all([
        this.database.client.providerAvailability.count({
          where: {
            tenantId: membership.tenantId,
            isActive: true,
            provider: {
              is: { status: 'ACTIVE', deletedAt: null },
            },
            branch: {
              is: { status: 'ACTIVE', deletedAt: null },
            },
          },
        }),
        this.database.client.providerAvailability.count({
          where: {
            tenantId: membership.tenantId,
            isActive: true,
            serviceId: { not: null },
            branchId: { not: null },
            provider: {
              is: { status: 'ACTIVE', deletedAt: null },
            },
            service: {
              is: { status: 'ACTIVE', deletedAt: null },
            },
            branch: {
              is: { status: 'ACTIVE', deletedAt: null },
            },
          },
        }),
        this.database.client.membership.count({
          where: {
            tenantId: membership.tenantId,
            status: 'ACTIVE',
            startsAt: { lte: new Date() },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
            roles: {
              some: {
                role: {
                  code: 'TENANT_ADMIN',
                  status: 'ACTIVE',
                },
              },
            },
            user: {
              is: {
                AND: [
                  {
                    identities: {
                      some: {
                        type: 'EMAIL',
                        verifiedAt: { not: null },
                        status: 'ACTIVE',
                      },
                    },
                  },
                  {
                    identities: {
                      some: {
                        type: 'PHONE',
                        verifiedAt: { not: null },
                        status: 'ACTIVE',
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      ]);

    return this.calculateAndPersist(
      membership.tenant,
      serviceCount,
      configuredServiceCount,
      activeServices,
      providerCount,
      administratorCount,
      branchCount,
      configuredBranchCount,
      activeBranches,
      activeDepartmentCount,
      documents,
      availabilityCount,
      serviceProviderLinkCount,
      verifiedAdministratorCount,
      bookingPolicy,
      paymentConfig,
      resourceCount,
      compliance,
      latestTestRun,
    );
  }

  async requestActivation(userId: string) {
    const readiness = await this.getSetup(userId);

    if (readiness.setup.status === TenantSetupStatus.LIVE) {
      return {
        accepted: true,
        status: TenantSetupStatus.LIVE,
        message: 'This facility is already accepting appointments.',
      };
    }

    if (!readiness.summary.ready) {
      const incomplete = readiness.requirements
        .filter((requirement) => requirement.required && !requirement.complete)
        .map((requirement) => requirement.label);
      throw new ConflictException({
        message: 'Facility activation is blocked until all required setup is complete.',
        incompleteRequirements: incomplete,
      });
    }

    const membership = await this.database.client.membership.findFirst({
      where: {
        userId,
        tenantId: readiness.tenant.id,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              code: 'TENANT_ADMIN',
              status: 'ACTIVE',
            },
          },
        },
      },
      select: { tenantId: true },
    });

    if (!membership) {
      throw new ForbiddenException('Only an active tenant administrator can request activation');
    }

    await this.database.client.$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          tenantId: membership.tenantId,
          actorUserId: userId,
          action: 'TENANT_ACTIVATION_REQUESTED',
          resourceType: 'TENANT_SETUP',
          resourceId: readiness.tenant.id,
          outcome: 'SUCCESS',
          reason:
            'Tenant administrator requested facility activation after passing readiness checks',
          metadata: {
            readinessPercent: readiness.setup.readinessPercent,
            completedRequirements: readiness.summary.completed,
            totalRequirements: readiness.summary.total,
          },
        },
      });

      await tx.tenantSetup.update({
        where: { tenantId: membership.tenantId },
        data: {
          status: TenantSetupStatus.READY,
          readyAt: new Date(),
          lastCalculatedAt: new Date(),
        },
      });
    });

    return {
      accepted: true,
      status: TenantSetupStatus.READY,
      message: 'Activation request recorded for platform review.',
    };
  }

  private async calculateAndPersist(
    tenant: {
      id: string;
      name: string;
      legalName: string | null;
      type: TenantType;
      status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
      profile: {
        businessName: string | null;
        legalName: string | null;
        businessType: string | null;
        registrationNumber: string | null;
        taxIdentificationNumber: string | null;
        registrationCountry: string | null;
        incorporationDate: Date | null;
        country: string;
        address: string | null;
        city: string | null;
        county: string | null;
        subcounty: string | null;
        postalCode: string | null;
        latitude: Prisma.Decimal | null;
        longitude: Prisma.Decimal | null;
        contactEmail: string | null;
        contactPhone: string | null;
        supportEmail: string | null;
        whatsappNumber: string | null;
        description: string | null;
        website: string | null;
      } | null;
      website: { slug: string; draftContent: Prisma.JsonValue } | null;
      setup: {
        status: TenantSetupStatus;
        readinessPercent: number;
        readyAt: Date | null;
        liveAt: Date | null;
        suspendedAt: Date | null;
      } | null;
      _count: {
        branches: number;
        departments: number;
        memberships: number;
      };
    },
    serviceCount: number,
    configuredServiceCount: number,
    activeServices: Array<{ price: Prisma.Decimal; durationMin: number | null }>,
    providerCount: number,
    administratorCount: number,
    branchCount: number,
    configuredBranchCount: number,
    activeBranches: Array<{
      address: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
      openingTime: string | null;
      closingTime: string | null;
      operatingDays: string[];
    }>,
    activeDepartmentCount: number,
    documents: Array<{
      type: string;
      status: string;
      verificationStatus: string;
      expiryDate: Date | null;
      storageKey: string | null;
    }>,
    availabilityCount: number,
    serviceProviderLinkCount: number,
    verifiedAdministratorCount: number,
    bookingPolicy: BookingPolicy | null,
    paymentConfig: OrganizationPaymentConfig | null,
    resourceCount: number,
    compliance: Pick<OrganizationCompliance, 'ownerIdentityStatus' | 'termsVersion' | 'termsAcceptedAt' | 'termsAcceptedByUserId'> | null,
    latestTestRun: ReadinessTestRun | null,
  ) {
    const requirements = this.buildRequirements(
      tenant,
      serviceCount,
      configuredServiceCount,
      activeServices,
      providerCount,
      administratorCount,
      branchCount,
      configuredBranchCount,
      activeBranches,
      activeDepartmentCount,
      documents,
      availabilityCount,
      serviceProviderLinkCount,
      verifiedAdministratorCount,
      bookingPolicy,
      paymentConfig,
      resourceCount,
      compliance,
      latestTestRun,
    );

    const completedCount = requirements.filter((requirement) => requirement.complete).length;
    const readinessPercent = Math.round((completedCount / requirements.length) * 100);

    const allRequiredComplete = requirements
      .filter((requirement) => requirement.required)
      .every((requirement) => requirement.complete);

    let status = tenant.setup?.status ?? TenantSetupStatus.NOT_STARTED;

    if (
      tenant.setup?.status !== TenantSetupStatus.LIVE &&
      tenant.setup?.status !== TenantSetupStatus.SUSPENDED
    ) {
      if (allRequiredComplete) {
        status = TenantSetupStatus.READY;
      } else if (readinessPercent > 0) {
        status = TenantSetupStatus.IN_PROGRESS;
      } else {
        status = TenantSetupStatus.NOT_STARTED;
      }
    }

    const setup = await this.database.client.tenantSetup.upsert({
      where: {
        tenantId: tenant.id,
      },
      create: {
        tenantId: tenant.id,
        status,
        readinessPercent,
        readyAt: allRequiredComplete ? new Date() : null,
        lastCalculatedAt: new Date(),
      },
      update: {
        status,
        readinessPercent,
        readyAt: allRequiredComplete ? (tenant.setup?.readyAt ?? new Date()) : null,
        lastCalculatedAt: new Date(),
      },
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        legalName: tenant.legalName,
        type: tenant.type,
        status: tenant.status,
      },
      setup: {
        status: setup.status,
        readinessPercent: setup.readinessPercent,
        readyAt: setup.readyAt,
        liveAt: setup.liveAt,
      },
      requirements,
      summary: {
        total: requirements.length,
        completed: completedCount,
        required: requirements.filter((item) => item.required).length,
        requiredCompleted: requirements.filter((item) => item.required && item.complete).length,
        ready: allRequiredComplete,
      },
      overallProgress: readinessPercent,
      sections: [{
        key: 'organization',
        title: 'Organization configuration',
        progress: completedCount,
        required: requirements.length,
        percent: readinessPercent,
        items: requirements,
      }],
    };
  }

  private buildRequirements(
    tenant: {
      type: TenantType;
      name: string;
      legalName: string | null;
      profile: {
        businessName: string | null;
        legalName: string | null;
        businessType: string | null;
        registrationNumber: string | null;
        taxIdentificationNumber: string | null;
        registrationCountry: string | null;
        incorporationDate: Date | null;
        country: string;
        county: string | null;
        subcounty: string | null;
        address: string | null;
        city: string | null;
        postalCode: string | null;
        latitude: Prisma.Decimal | null;
        longitude: Prisma.Decimal | null;
        contactEmail: string | null;
        contactPhone: string | null;
        supportEmail: string | null;
        whatsappNumber: string | null;
        description: string | null;
        website: string | null;
      } | null;
      website: { slug: string; draftContent: Prisma.JsonValue } | null;
      _count: {
        branches: number;
        departments: number;
        memberships: number;
      };
    },
    serviceCount: number,
    configuredServiceCount: number,
    activeServices: Array<{ price: Prisma.Decimal; durationMin: number | null }>,
    providerCount: number,
    administratorCount: number,
    branchCount: number,
    configuredBranchCount: number,
    activeBranches: Array<{
      address: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
      openingTime: string | null;
      closingTime: string | null;
      operatingDays: string[];
    }>,
    activeDepartmentCount: number,
    documents: Array<{
      type: string;
      status: string;
      verificationStatus: string;
      expiryDate: Date | null;
      storageKey: string | null;
    }>,
    availabilityCount: number,
    serviceProviderLinkCount: number,
    verifiedAdministratorCount: number,
    bookingPolicy: BookingPolicy | null,
    paymentConfig: OrganizationPaymentConfig | null,
    resourceCount: number,
    compliance: Pick<OrganizationCompliance, 'ownerIdentityStatus' | 'termsVersion' | 'termsAcceptedAt' | 'termsAcceptedByUserId'> | null,
    latestTestRun: ReadinessTestRun | null,
  ): ReadinessRequirement[] {
    const profile = tenant.profile;

    const requiredDocumentTypes = ['BUSINESS_PERMIT', 'HEALTHCARE_FACILITY_LICENSE'];
    const websiteContent = tenant.website?.draftContent && typeof tenant.website.draftContent === 'object'
      ? tenant.website.draftContent as Record<string, unknown>
      : {};
    const submittedDocumentTypes = new Set(documents.map((document) => document.type));
    const registrationDocument = documents.some(
      (document) => document.type === 'REGISTRATION_CERTIFICATE' && Boolean(document.storageKey),
    );
    const requiredDocumentsApproved = requiredDocumentTypes.every((type) =>
      documents.some(
        (document) =>
          document.type === type &&
          Boolean(document.storageKey) &&
          document.status === 'VERIFIED' &&
          document.verificationStatus === 'VERIFIED' &&
          (!document.expiryDate || document.expiryDate > new Date()),
      ),
    );

    const requirements: ReadinessRequirement[] = [
      {
        key: 'organization_identity',
        label: 'Organization identity',
        weight: 15,
        required: true,
        available: true,
        complete: Boolean(
          tenant.name.trim() &&
          (profile?.businessName?.trim() || tenant.name.trim()) &&
          (profile?.legalName?.trim() || tenant.legalName?.trim()) &&
          typeof websiteContent.logoUrl === 'string' && Boolean(websiteContent.logoUrl.trim()) &&
          typeof websiteContent.description === 'string' && Boolean(websiteContent.description.trim()) &&
          typeof websiteContent.primaryColor === 'string' && Boolean(websiteContent.primaryColor.trim()) &&
          typeof websiteContent.secondaryColor === 'string' && Boolean(websiteContent.secondaryColor.trim()),
        ),
      },
      {
        key: 'legal_information',
        label: 'Legal and registration information',
        weight: 10,
        required: true,
        available: true,
        complete: Boolean(
          profile?.registrationNumber?.trim() &&
          profile.taxIdentificationNumber?.trim() &&
          profile.registrationCountry?.trim() &&
          profile.businessType?.trim() &&
          profile.incorporationDate &&
          registrationDocument,
        ),
      },
      {
        key: 'location',
        label: 'Organization location',
        weight: 10,
        required: true,
        available: true,
        complete: Boolean(
          profile?.address?.trim() &&
          profile.city?.trim() &&
          profile.county?.trim() &&
          profile.country?.trim() &&
          profile.postalCode?.trim() &&
          profile.latitude !== null &&
          profile.longitude !== null,
        ),
      },
      {
        key: 'official_contacts',
        label: 'Official contact details',
        weight: 10,
        required: true,
        available: true,
        complete: Boolean(
          profile?.contactPhone?.trim() &&
          profile.contactEmail?.trim() &&
          profile.whatsappNumber?.trim() &&
          profile.supportEmail?.trim(),
        ),
      },
      {
        key: 'administrator',
        label: 'Administrator access',
        weight: 10,
        required: true,
        available: true,
        complete: administratorCount > 0,
      },
      {
        key: 'documents_uploaded',
        label: 'Facility permit and license uploaded',
        weight: 8,
        required: true,
        available: true,
        complete: requiredDocumentTypes.every((type) =>
          documents.some((document) => document.type === type && Boolean(document.storageKey)),
        ),
      },
      {
        key: 'documents_approved',
        label: 'Facility documents approved',
        weight: 8,
        required: true,
        available: true,
        complete: requiredDocumentsApproved,
      },
      {
        key: 'administrator_contacts_verified',
        label: 'Tenant administrator email and phone verified',
        weight: 6,
        required: true,
        available: true,
        complete: verifiedAdministratorCount > 0,
      },
      {
        key: 'owner_identity_verified',
        label: 'Facility owner identity verified',
        weight: 6,
        required: true,
        available: true,
        complete: compliance?.ownerIdentityStatus === 'VERIFIED',
      },
      {
        key: 'branches',
        label: 'At least one active branch',
        weight: 10,
        required: true,
        available: true,
        complete: branchCount > 0,
      },
      {
        key: 'branch_configuration',
        label: 'Branch address, contact, and operating hours configured',
        weight: 8,
        required: true,
        available: true,
        complete: branchCount > 0 && configuredBranchCount === branchCount,
      },
      {
        key: 'departments',
        label: 'Departments',
        weight: 10,
        required: this.requiresDepartments(tenant.type),
        available: true,
        complete: activeDepartmentCount > 0,
      },
      {
        key: 'services',
        label: 'At least one active service',
        weight: 10,
        required: true,
        available: true,
        complete: serviceCount > 0,
      },
      {
        key: 'service_pricing',
        label: 'Service pricing and duration configured',
        weight: 8,
        required: true,
        available: true,
        complete: configuredServiceCount > 0,
      },
      {
        key: 'providers',
        label: 'Providers',
        weight: 5,
        required: this.requiresProviders(tenant.type),
        available: true,
        complete: providerCount > 0,
      },
      {
        key: 'provider_calendar',
        label: 'Provider availability configured',
        weight: 8,
        required: this.requiresProviders(tenant.type),
        available: true,
        complete: availabilityCount > 0,
      },
      {
        key: 'service_provider_link',
        label: 'Active service linked to provider and branch',
        weight: 6,
        required: this.requiresProviders(tenant.type),
        available: true,
        complete: serviceProviderLinkCount > 0,
      },
      {
        key: 'resources',
        label: 'Operational resources',
        weight: 5,
        required: this.requiresResources(tenant.type),
        available: true,
        complete: !this.requiresResources(tenant.type) || resourceCount > 0,
      },
      {
        key: 'booking_rules',
        label: 'Booking and cancellation rules configured',
        weight: 8,
        required: true,
        available: true,
        complete: Boolean(bookingPolicy && bookingPolicy.allowOnlineBooking && bookingPolicy.maxBookingsPerDay > 0),
      },
      {
        key: 'payments',
        label: 'Payment method configured',
        weight: 7,
        required: true,
        available: true,
        complete: Boolean(
          paymentConfig &&
          (paymentConfig.acceptCash ||
            (paymentConfig.acceptMpesa && Boolean(paymentConfig.mpesaPaybill)) ||
            paymentConfig.acceptCard ||
            (paymentConfig.acceptBankTransfer && Boolean(paymentConfig.bankAccountName && paymentConfig.bankAccountNumber))),
        ),
      },
      {
        key: 'terms_accepted',
        label: 'Revaltrix terms and privacy policy accepted',
        weight: 4,
        required: true,
        available: true,
        complete: Boolean(
          compliance?.termsAcceptedAt &&
          compliance.termsAcceptedByUserId &&
          process.env.REVALTRIX_TERMS_VERSION &&
          compliance.termsVersion === process.env.REVALTRIX_TERMS_VERSION,
        ),
      },
      {
        key: 'test_booking',
        label: 'Test booking, reschedule, cancellation, and reminder passed',
        weight: 5,
        required: true,
        available: true,
        complete: Boolean(latestTestRun && latestTestRun.bookingStatus === 'PASSED' && latestTestRun.rescheduleStatus === 'PASSED' && latestTestRun.cancellationStatus === 'PASSED' && latestTestRun.reminderStatus === 'PASSED'),
      },
    ];

    const incompleteReasons: Record<string, string> = {
      organization_identity: 'Set the organization display name and legal name in the organization profile.',
      legal_information: 'Enter the organization registration number and tax identification number in the organization profile.',
      location: 'Enter the country and public physical address in the organization profile.',
      official_contacts: 'Enter both the organization contact email and phone in the organization profile.',
      administrator: 'Assign an active tenant administrator role to at least one active organization member.',
      documents_uploaded: 'Upload the required facility permit and healthcare facility license.',
      documents_approved: 'Both required documents must be approved by the verification workflow.',
      administrator_contacts_verified: 'The active tenant administrator must complete both email and phone verification.',
      owner_identity_verified: compliance?.ownerIdentityStatus === 'PENDING_REVIEW' ? 'Identity evidence has been submitted and is pending authorized review.' : 'Submit owner identity evidence; only an authorized reviewer can mark it verified.',
      branches: 'Create at least one active branch.',
      branch_configuration: 'Each active branch needs an address, a contact, opening/closing times, and operating days.',
      departments: 'Create at least one active department for this organization type.',
      services: 'Create at least one active service.',
      service_pricing: 'At least one active service must have a price greater than zero and a configured duration.',
      providers: 'Create at least one active provider profile for this organization.',
      provider_calendar: 'Provider schedule records are not configured through a tenant-facing calendar setup screen.',
      service_provider_link: 'Link an active provider, service, and branch in provider availability; this relationship has no tenant setup screen yet.',
      resources: 'Add at least one active room, equipment item, bed, vehicle, or other resource.',
      booking_rules: 'Configure the booking lead time, cancellation/reschedule windows, and daily limit.',
      payments: 'Select at least one accepted payment preference and provide its required details.',
      terms_accepted: process.env.REVALTRIX_TERMS_VERSION ? 'Review and accept the current Revaltrix terms.' : 'Current terms version is not configured by the platform.',
      test_booking: 'Run real booking, reschedule, cancellation, and reminder tests; no automated test runner is configured.',
    };

    const profileMissing = (fields: Array<[string, unknown]>) =>
      fields.filter(([, value]) => value === null || value === undefined || value === '').map(([key]) => key);
    const missingByKey: Record<string, string[]> = {
      organization_identity: profileMissing([
        ['name', tenant.name],
        ['description', websiteContent.description || profile?.description],
        ['logoUrl', websiteContent.logoUrl],
        ['primaryColor', websiteContent.primaryColor],
        ['secondaryColor', websiteContent.secondaryColor],
      ]),
      legal_information: profileMissing([
        ['registrationNumber', profile?.registrationNumber],
        ['taxIdentificationNumber', profile?.taxIdentificationNumber],
        ['registrationCountry', profile?.registrationCountry],
        ['businessType', profile?.businessType],
        ['incorporationDate', profile?.incorporationDate],
      ]).concat(registrationDocument ? [] : ['registrationDocument']),
      location: profileMissing([
        ['address', profile?.address],
        ['city', profile?.city],
        ['county', profile?.county],
        ['country', profile?.country],
        ['postalCode', profile?.postalCode],
        ['latitude', profile?.latitude],
        ['longitude', profile?.longitude],
      ]),
      official_contacts: profileMissing([
        ['publicPhone', profile?.contactPhone],
        ['publicEmail', profile?.contactEmail],
        ['whatsappNumber', profile?.whatsappNumber],
        ['supportEmail', profile?.supportEmail],
      ]).concat(verifiedAdministratorCount > 0 ? [] : ['verifiedAdministratorEmail', 'verifiedAdministratorPhone']),
      administrator: administratorCount > 0 ? [] : ['activeOwnerOrAdmin'],
      documents_uploaded: requiredDocumentTypes.flatMap((type) => {
        const document = documents.find((item) => item.type === type && item.storageKey);
        return document ? [] : [type];
      }),
      documents_approved: requiredDocumentTypes.flatMap((type) => {
        const document = documents.find((item) => item.type === type && item.storageKey);
        return document?.status === 'VERIFIED' && document.verificationStatus === 'VERIFIED' &&
          (!document.expiryDate || document.expiryDate > new Date()) ? [] : [type];
      }),
      administrator_contacts_verified: verifiedAdministratorCount > 0 ? [] : ['emailVerifiedAt', 'phoneVerifiedAt'],
      owner_identity_verified: compliance?.ownerIdentityStatus === 'VERIFIED' ? [] : ['ownerIdType', 'ownerIdDocument', 'ownerSelfie', 'verificationStatus'],
      branches: branchCount > 0 ? [] : ['activeBranch'],
      branch_configuration: activeBranches.flatMap((branch) => profileMissing([
        ['branch.address', branch.address],
        ['branch.phone', branch.contactPhone],
        ['branch.email', branch.contactEmail],
        ['branch.openingTime', branch.openingTime],
        ['branch.closingTime', branch.closingTime],
        ['branch.operatingDays', branch.operatingDays.length ? 'configured' : null],
      ])),
      departments: !this.requiresDepartments(tenant.type) || activeDepartmentCount > 0 ? [] : ['activeDepartment'],
      services: serviceCount > 0 ? [] : ['activeService'],
      service_pricing: activeServices.flatMap((service) => profileMissing([
        ['service.price', Number(service.price) > 0 ? 'configured' : null],
        ['service.durationMin', service.durationMin && service.durationMin > 0 ? 'configured' : null],
        ['service.currency', paymentConfig?.currency],
      ])),
      providers: !this.requiresProviders(tenant.type) || providerCount > 0 ? [] : ['activeProvider'],
      provider_calendar: !this.requiresProviders(tenant.type) || availabilityCount > 0 ? [] : ['providerAvailability'],
      service_provider_link: !this.requiresProviders(tenant.type) || serviceProviderLinkCount > 0 ? [] : ['providerId', 'serviceId', 'branchId'],
      resources: !this.requiresResources(tenant.type) || resourceCount > 0 ? [] : ['activeResource'],
      booking_rules: bookingPolicy ? [] : ['minLeadTimeMinutes', 'cancellationWindowHours', 'rescheduleWindowHours', 'maxBookingsPerDay'],
      payments: paymentConfig && (paymentConfig.acceptCash || (paymentConfig.acceptMpesa && paymentConfig.mpesaPaybill) || paymentConfig.acceptCard || (paymentConfig.acceptBankTransfer && paymentConfig.bankAccountName && paymentConfig.bankAccountNumber)) ? [] : ['enabledPaymentMethod'],
      terms_accepted: compliance?.termsAcceptedAt && compliance.termsAcceptedByUserId && process.env.REVALTRIX_TERMS_VERSION && compliance.termsVersion === process.env.REVALTRIX_TERMS_VERSION ? [] : ['termsVersion', 'acceptedBy', 'acceptedAt'],
      test_booking: latestTestRun?.bookingStatus === 'PASSED' && latestTestRun.rescheduleStatus === 'PASSED' && latestTestRun.cancellationStatus === 'PASSED' && latestTestRun.reminderStatus === 'PASSED' ? [] : ['bookingTest', 'rescheduleTest', 'cancellationTest', 'reminderTest'],
    };
    const routes: Record<string, string> = {
      organization_identity: '/tenant/website',
      legal_information: '/tenant/organization',
      location: '/tenant/organization',
      official_contacts: '/tenant/organization',
      branches: '/tenant/branches',
      branch_configuration: '/tenant/branches',
      departments: '/tenant/departments',
      services: '/tenant/services',
      service_pricing: '/tenant/services',
      booking_rules: '/tenant/setup?section=booking',
      payments: '/tenant/setup?section=payments',
      resources: '/tenant/setup?section=resources',
      documents_uploaded: '/tenant/setup?section=documents',
      documents_approved: '/tenant/setup?section=documents',
      terms_accepted: '/tenant/setup?section=terms',
    };
    const fieldTotals: Record<string, number> = {
      organization_identity: 5,
      legal_information: 6,
      location: 7,
      official_contacts: 6,
      administrator: 1,
      documents_uploaded: 2,
      documents_approved: 2,
      administrator_contacts_verified: 2,
      owner_identity_verified: 4,
      branches: 1,
      branch_configuration: Math.max(1, activeBranches.length * 6),
      departments: 1,
      services: 1,
      service_pricing: Math.max(1, activeServices.length * 3),
      providers: 1,
      provider_calendar: 1,
      service_provider_link: 3,
      resources: 1,
      booking_rules: 1,
      payments: 1,
      terms_accepted: 3,
      test_booking: 4,
    };

    return requirements.map((requirement) => {
      const notApplicable = !requirement.required;
      const missing = notApplicable ? [] : (missingByKey[requirement.key] ?? []);
      const complete = requirement.complete || notApplicable || missing.length === 0;
      const submittedDocument = requirement.key === 'documents_approved' &&
        requiredDocumentTypes.some((type) => documents.some((document) => document.type === type && document.storageKey && document.status !== 'VERIFIED'));
      const identityPending = requirement.key === 'owner_identity_verified' && compliance?.ownerIdentityStatus === 'PENDING_REVIEW';
      const blocked = requirement.key === 'test_booking' || ['provider_calendar', 'service_provider_link'].includes(requirement.key);
      const status = complete ? 'COMPLETE' : submittedDocument || identityPending ? 'PENDING_REVIEW' : blocked ? 'BLOCKED' : 'INCOMPLETE';
      const totalFields = fieldTotals[requirement.key] ?? 1;
      const progress = complete ? 100 : Math.max(0, Math.round(((totalFields - Math.min(missing.length, totalFields)) / totalFields) * 100));
      const ctaLabels: Record<string, string> = {
        organization_identity: 'Edit website',
        legal_information: 'Enter details',
        location: 'Edit location',
        official_contacts: 'Edit contacts',
        branches: 'Review',
        branch_configuration: 'Configure branches',
        departments: 'Review',
        services: 'Review',
        service_pricing: 'Configure services',
        booking_rules: 'Configure rules',
        payments: 'Configure payments',
        resources: 'Add resources',
        terms_accepted: 'Accept terms',
      };
      return {
        ...requirement,
        complete,
        missing,
        progress,
        status,
        ...(routes[requirement.key] ? { ctaRoute: routes[requirement.key] } : {}),
        ctaLabel: complete ? 'Review' : ctaLabels[requirement.key] ?? 'Open setup',
        reason: complete
          ? notApplicable ? 'Not required for this organization type.' : 'Verified from current organization records.'
          : incompleteReasons[requirement.key] ?? 'Complete the linked organization setup and refresh readiness.',
      };
    });
  }

  private requiresDepartments(type: TenantType): boolean {
    return (
      type !== TenantType.OPTICAL_CENTER &&
      type !== TenantType.PHARMACY &&
      type !== TenantType.AMBULANCE_PROVIDER
    );
  }

  private requiresProviders(type: TenantType): boolean {
    return type !== TenantType.PHARMACY && type !== TenantType.AMBULANCE_PROVIDER;
  }

  private requiresResources(type: TenantType): boolean {
    return type !== TenantType.OTHER_HEALTHCARE_PROVIDER;
  }
}
