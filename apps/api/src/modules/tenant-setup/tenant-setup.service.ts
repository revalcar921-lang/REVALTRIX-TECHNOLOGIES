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
  NotificationChannel,
  Prisma,
  TenantDocumentStatus,
  TenantDocumentVerificationStatus,
  TenantSetupStatus,
  TenantType,
  type BookingPolicy,
  type OrganizationCompliance,
  type OrganizationPaymentConfig,
} from '@prisma/client';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type {
  AcceptTenantTermsDto,
  CreateOperationalResourceDto,
  UpdateBookingPolicyDto,
  UpdateOrganizationPaymentConfigDto,
  UploadTenantDocumentDto,
  ReviewTenantDocumentDto,
  ReviewTenantActivationDto,
} from './dto/tenant-setup-config.dto.js';

const DEFAULT_PLATFORM_TERMS_VERSION = '2026-10-21';

function getPlatformTermsConfiguration() {
  return {
    version: process.env.REVALTRIX_TERMS_VERSION?.trim() || DEFAULT_PLATFORM_TERMS_VERSION,
    termsUrl: process.env.REVALTRIX_TERMS_URL?.trim() || '/terms',
    privacyUrl: process.env.REVALTRIX_PRIVACY_URL?.trim() || '/privacy',
  };
}

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
    private readonly notifications: NotificationsService,
  ) {}

  async getTenantSettings(userId: string) {
    const membership = await this.database.client.membership.findFirst({
      where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      select: { tenantId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('Active tenant membership not found.');
    const [bookingPolicy, paymentConfig, resources, compliance, documents] = await Promise.all([
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
    const platformTerms = getPlatformTermsConfiguration();
    return {
      bookingPolicy,
      paymentConfig,
      resources,
      compliance,
      documents,
      currentTermsVersion: platformTerms.version,
      termsUrl: platformTerms.termsUrl,
      privacyUrl: platformTerms.privacyUrl,
    };
  }

  async listPendingTenantDocuments() {
    return this.database.client.tenantDocument.findMany({
      where: {
        verificationStatus: TenantDocumentVerificationStatus.PENDING,
        status: { in: [TenantDocumentStatus.UPLOADED, TenantDocumentStatus.UNDER_REVIEW] },
        storageKey: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        type: true,
        title: true,
        documentNumber: true,
        issuingAuthority: true,
        issueDate: true,
        expiryDate: true,
        status: true,
        verificationStatus: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        uploadedByUserId: true,
        createdAt: true,
        tenant: { select: { name: true, code: true, type: true, profile: { select: { businessName: true, registrationNumber: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async downloadTenantReviewDocument(reviewerUserId: string, documentId: string) {
    const document = await this.database.client.tenantDocument.findFirst({
      where: {
        id: documentId,
        verificationStatus: TenantDocumentVerificationStatus.PENDING,
        storageKey: { not: null },
      },
      select: { id: true, tenantId: true, storageKey: true, fileName: true, mimeType: true },
    });
    if (!document?.storageKey) throw new NotFoundException('Pending compliance document was not found');
    const buffer = await this.storage.get(document.storageKey);
    await this.database.client.auditEvent.create({
      data: {
        tenantId: document.tenantId,
        actorUserId: reviewerUserId,
        action: 'TENANT_COMPLIANCE_DOCUMENT_VIEWED',
        resourceType: 'TENANT_DOCUMENT',
        resourceId: document.id,
        outcome: 'SUCCESS',
      },
    });
    return { buffer, fileName: document.fileName ?? 'compliance-document', contentType: document.mimeType ?? 'application/octet-stream' };
  }

  async reviewTenantDocument(reviewerUserId: string, documentId: string, dto: ReviewTenantDocumentDto) {
    if (dto.decision === 'REJECTED' && !dto.reason?.trim()) {
      throw new ConflictException('A rejection reason is required.');
    }
    const document = await this.database.client.tenantDocument.findFirst({
      where: { id: documentId, verificationStatus: TenantDocumentVerificationStatus.PENDING },
      select: { id: true, tenantId: true, title: true, type: true, status: true },
    });
    if (!document) throw new NotFoundException('Pending compliance document was not found');
    const now = new Date();
    const nextStatus = dto.decision === 'VERIFIED' ? TenantDocumentStatus.VERIFIED : TenantDocumentStatus.REJECTED;
    await this.database.client.$transaction(async (tx) => {
      await tx.tenantDocument.update({
        where: { id: document.id },
        data: {
          status: nextStatus,
          verificationStatus: dto.decision,
          verifiedByUserId: reviewerUserId,
          verifiedAt: now,
          rejectionReason: dto.decision === 'REJECTED' ? dto.reason!.trim() : null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: document.tenantId,
          actorUserId: reviewerUserId,
          action: `TENANT_COMPLIANCE_DOCUMENT_${dto.decision}`,
          resourceType: 'TENANT_DOCUMENT',
          resourceId: document.id,
          outcome: 'SUCCESS',
          reason: dto.reason?.trim() ?? null,
          metadata: { type: document.type },
        },
      });
    });
    await this.notifyTenantAdmins(
      document.tenantId,
      'TENANT_COMPLIANCE_DOCUMENT_REVIEWED',
      `Facility document ${dto.decision === 'VERIFIED' ? 'approved' : 'rejected'}`,
      dto.decision === 'VERIFIED'
        ? `${document.title} was verified by the Revaltrix review team.`
        : `${document.title} was rejected. Reason: ${dto.reason!.trim()}`,
      `tenant-document:${document.id}:${dto.decision}`,
      { documentId: document.id, decision: dto.decision },
    );
    return { id: document.id, status: nextStatus, verificationStatus: dto.decision };
  }

  async listPendingActivations() {
    return this.database.client.tenantSetup.findMany({
      where: { status: TenantSetupStatus.READY, activationRequestedAt: { not: null }, activationReviewedAt: null },
      select: {
        id: true,
        tenantId: true,
        readinessPercent: true,
        readyAt: true,
        activationRequestedAt: true,
        tenant: { select: { name: true, legalName: true, type: true, code: true, profile: { select: { businessName: true, registrationNumber: true, contactEmail: true, contactPhone: true } } } },
      },
      orderBy: { activationRequestedAt: 'asc' },
    });
  }

  async reviewActivation(reviewerUserId: string, tenantId: string, dto: ReviewTenantActivationDto) {
    if (dto.decision === 'REJECT' && !dto.reason?.trim()) throw new ConflictException('A rejection reason is required.');
    const setup = await this.database.client.tenantSetup.findFirst({
      where: { tenantId, status: TenantSetupStatus.READY, activationRequestedAt: { not: null }, activationReviewedAt: null },
      select: { id: true },
    });
    if (!setup) throw new NotFoundException('Pending activation request was not found');
    if (dto.decision === 'APPROVE') {
      const adminMembership = await this.database.client.membership.findFirst({
        where: {
          tenantId,
          status: 'ACTIVE',
          roles: { some: { role: { code: 'TENANT_ADMIN', status: 'ACTIVE' } } },
        },
        select: { userId: true },
      });
      if (!adminMembership) throw new ConflictException('No active tenant administrator is available to validate readiness.');
      const readiness = await this.getSetup(adminMembership.userId);
      if (!readiness.summary.ready) throw new ConflictException('Tenant readiness changed. The facility must complete its current required items before activation.');
    }
    const now = new Date();
    const approved = dto.decision === 'APPROVE';
    await this.database.client.$transaction(async (tx) => {
      await tx.tenantSetup.update({
        where: { id: setup.id },
        data: {
          status: approved ? TenantSetupStatus.LIVE : TenantSetupStatus.READY,
          liveAt: approved ? now : null,
          activationRequestedAt: null,
          activationReviewedAt: now,
          activationReviewedByUserId: reviewerUserId,
          activationReviewReason: approved ? null : dto.reason!.trim(),
          lastCalculatedAt: now,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: reviewerUserId,
          action: `TENANT_ACTIVATION_${dto.decision}`,
          resourceType: 'TENANT_SETUP',
          resourceId: setup.id,
          outcome: 'SUCCESS',
          reason: dto.reason?.trim() ?? null,
        },
      });
    });
    await this.notifyTenantAdmins(
      tenantId,
      `TENANT_ACTIVATION_${dto.decision}`,
      approved ? 'Facility activated' : 'Activation request needs changes',
      approved
        ? 'Your facility has been approved for activation and is now live.'
        : `Your activation request was not approved. Reason: ${dto.reason!.trim()}`,
      `tenant-activation:${tenantId}:${dto.decision}:${now.toISOString()}`,
      { tenantId, decision: dto.decision },
    );
    return { tenantId, status: approved ? TenantSetupStatus.LIVE : TenantSetupStatus.READY, decision: dto.decision };
  }

  private async notifyTenantAdmins(tenantId: string, type: string, title: string, body: string, eventKey: string, data: Record<string, unknown>) {
    const admins = await this.database.client.membership.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        roles: { some: { role: { code: 'TENANT_ADMIN', status: 'ACTIVE' } } },
      },
      select: { userId: true },
    });
    await Promise.all([...new Set(admins.map(({ userId }) => userId))].map((recipientUserId) =>
      this.notifications.createNotification({
        tenantId,
        recipientUserId,
        type,
        title,
        body,
        data,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        idempotencyPrefix: eventKey,
      }),
    ));
  }

  private async notifyPlatformReviewers(type: string, title: string, body: string, eventKey: string, data: Record<string, unknown>) {
    const reviewers = await this.database.client.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        platformRoleAssignments: {
          some: {
            role: {
              scope: 'PLATFORM',
              status: 'ACTIVE',
              code: { in: ['PLATFORM_ADMIN', 'PLATFORM_VERIFIER', 'VERIFICATION_REVIEWER'] },
            },
          },
        },
      },
      select: { id: true },
    });
    await Promise.all([...new Set(reviewers.map(({ id }) => id))].map((recipientUserId) =>
      this.notifications.createNotification({
        recipientUserId,
        type,
        title,
        body,
        data,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        idempotencyPrefix: eventKey,
      }),
    ));
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
    const currentTermsVersion = getPlatformTermsConfiguration().version;
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

    const [bookingPolicy, paymentConfig, resourceCount, compliance] =
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
      ]);

    const [availabilityCount, serviceProviderLinkCount, verifiedAdministratorEmailCount, ownershipPartyStatuses] =
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
                identities: {
                  some: {
                    type: 'EMAIL',
                    verifiedAt: { not: null },
                    status: 'ACTIVE',
                  },
                },
              },
            },
          },
        }),
        this.database.client.tenantOwnershipParty.findMany({
          where: { tenantId: membership.tenantId },
          select: { status: true },
        }),
      ]);
    const ownershipIdentityVerified = compliance?.ownerIdentityStatus === 'VERIFIED' &&
      ownershipPartyStatuses.length > 0 &&
      ownershipPartyStatuses.every((party) => party.status === 'VERIFIED');

    return this.calculateAndPersist(
      membership.tenant,
      serviceCount,
      configuredServiceCount,
      activeServices,
      administratorCount,
      branchCount,
      configuredBranchCount,
      activeBranches,
      activeDepartmentCount,
      documents,
      availabilityCount,
      serviceProviderLinkCount,
      verifiedAdministratorEmailCount,
      bookingPolicy,
      paymentConfig,
      resourceCount,
      compliance,
      ownershipIdentityVerified,
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

    const pendingActivation = await this.database.client.tenantSetup.findUnique({
      where: { tenantId: readiness.tenant.id },
      select: { activationRequestedAt: true, activationReviewedAt: true },
    });
    if (pendingActivation?.activationRequestedAt && !pendingActivation.activationReviewedAt) {
      return {
        accepted: true,
        status: TenantSetupStatus.READY,
        message: 'An activation request is already pending platform review.',
      };
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

    const activationRequestedAt = new Date();
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
          readyAt: activationRequestedAt,
          activationRequestedAt,
          activationReviewedAt: null,
          activationReviewedByUserId: null,
          activationReviewReason: null,
          lastCalculatedAt: activationRequestedAt,
        },
      });
    });

    await this.notifyPlatformReviewers(
      'TENANT_ACTIVATION_REQUESTED',
      'Facility activation request',
      `${readiness.tenant.name} is ready for activation review.`,
      `tenant-activation-request:${membership.tenantId}:${activationRequestedAt.toISOString()}`,
      { tenantId: membership.tenantId },
    );

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
    verifiedAdministratorEmailCount: number,
    bookingPolicy: BookingPolicy | null,
    paymentConfig: OrganizationPaymentConfig | null,
    resourceCount: number,
    compliance: Pick<OrganizationCompliance, 'ownerIdentityStatus' | 'termsVersion' | 'termsAcceptedAt' | 'termsAcceptedByUserId'> | null,
    ownershipIdentityVerified: boolean,
  ) {
    const currentTermsVersion = getPlatformTermsConfiguration().version;
    const requirements = this.buildRequirements(
      tenant,
      serviceCount,
      configuredServiceCount,
      activeServices,
      administratorCount,
      branchCount,
      configuredBranchCount,
      activeBranches,
      activeDepartmentCount,
      documents,
      availabilityCount,
      serviceProviderLinkCount,
      verifiedAdministratorEmailCount,
      bookingPolicy,
      paymentConfig,
      resourceCount,
      compliance,
      ownershipIdentityVerified,
      currentTermsVersion,
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
    verifiedAdministratorEmailCount: number,
    bookingPolicy: BookingPolicy | null,
    paymentConfig: OrganizationPaymentConfig | null,
    resourceCount: number,
    compliance: Pick<OrganizationCompliance, 'ownerIdentityStatus' | 'termsVersion' | 'termsAcceptedAt' | 'termsAcceptedByUserId'> | null,
    ownershipIdentityVerified: boolean,
    currentTermsVersion: string,
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
        label: 'Tenant administrator email verified',
        weight: 6,
        required: true,
        available: true,
        complete: verifiedAdministratorEmailCount > 0,
      },
      {
        key: 'owner_identity_verified',
        label: 'Facility ownership and controllers verified',
        weight: 6,
        required: true,
        available: true,
        complete: ownershipIdentityVerified,
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
        weight: 15,
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
        key: 'provider_calendar',
        label: 'Appointment team availability configured',
        weight: 8,
        required: this.requiresProviders(tenant.type),
        available: true,
        complete: availabilityCount > 0,
      },
      {
        key: 'service_provider_link',
        label: 'Appointment services linked to a team and branch',
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
          compliance.termsVersion === currentTermsVersion,
        ),
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
      administrator_contacts_verified: 'Verify the active tenant administrator email through the tenant registration OTP. Phone verification is tracked separately.',
      owner_identity_verified: compliance?.ownerIdentityStatus === 'PENDING_REVIEW' ? 'Ownership parties and their evidence are pending authorized platform review.' : 'Declare the owner, company directors/beneficial owners, or government authorized officials and submit their evidence for platform review.',
      branches: 'Create at least one active branch.',
      branch_configuration: 'Each active branch needs an address, a contact, opening/closing times, and operating days.',
      departments: 'Create at least one active department for this organization type.',
      services: 'Create at least one active service.',
      service_pricing: 'At least one active service must have a price greater than zero and a configured duration.',
      provider_calendar: 'Configure at least one active team schedule so the system can assign a suitable team member when a patient books.',
      service_provider_link: 'Link appointment services and branches to an active team schedule so department bookings can be assigned.',
      resources: 'Add at least one active room, equipment item, bed, vehicle, or other resource.',
      booking_rules: 'Configure the booking lead time, cancellation/reschedule windows, and daily limit.',
      payments: 'Select at least one accepted payment preference and provide its required details.',
      terms_accepted: 'Review and accept the current Revaltrix Terms and Privacy Policy.',
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
      ]),
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
      administrator_contacts_verified: verifiedAdministratorEmailCount > 0 ? [] : ['emailVerifiedAt'],
      owner_identity_verified: ownershipIdentityVerified ? [] : ['ownershipParties', 'requiredEvidence', 'reviewStatus'],
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
      provider_calendar: !this.requiresProviders(tenant.type) || availabilityCount > 0 ? [] : ['providerAvailability'],
      service_provider_link: !this.requiresProviders(tenant.type) || serviceProviderLinkCount > 0 ? [] : ['providerId', 'serviceId', 'branchId'],
      resources: !this.requiresResources(tenant.type) || resourceCount > 0 ? [] : ['activeResource'],
      booking_rules: bookingPolicy ? [] : ['minLeadTimeMinutes', 'cancellationWindowHours', 'rescheduleWindowHours', 'maxBookingsPerDay'],
      payments: paymentConfig && (paymentConfig.acceptCash || (paymentConfig.acceptMpesa && paymentConfig.mpesaPaybill) || paymentConfig.acceptCard || (paymentConfig.acceptBankTransfer && paymentConfig.bankAccountName && paymentConfig.bankAccountNumber)) ? [] : ['enabledPaymentMethod'],
      terms_accepted: compliance?.termsAcceptedAt && compliance.termsAcceptedByUserId && compliance.termsVersion === currentTermsVersion ? [] : ['termsVersion', 'acceptedBy', 'acceptedAt'],
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
      provider_calendar: '/tenant/providers',
      service_provider_link: '/tenant/providers',
      administrator_contacts_verified: '/register/tenant/dashboard',
      owner_identity_verified: '/tenant/setup?section=ownership',
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
      administrator_contacts_verified: 1,
      owner_identity_verified: 3,
      branches: 1,
      branch_configuration: Math.max(1, activeBranches.length * 6),
      departments: 1,
      services: 1,
      service_pricing: Math.max(1, activeServices.length * 3),
      provider_calendar: 1,
      service_provider_link: 3,
      resources: 1,
      booking_rules: 1,
      payments: 1,
      terms_accepted: 3,
    };

    return requirements.map((requirement) => {
      const notApplicable = !requirement.required;
      const missing = notApplicable ? [] : (missingByKey[requirement.key] ?? []);
      const complete = requirement.complete || notApplicable || missing.length === 0;
      const submittedDocument = requirement.key === 'documents_approved' &&
        requiredDocumentTypes.some((type) => documents.some((document) => document.type === type && document.storageKey && document.status !== 'VERIFIED'));
      const identityPending = requirement.key === 'owner_identity_verified' && compliance?.ownerIdentityStatus === 'PENDING_REVIEW';
      const status = complete ? 'COMPLETE' : submittedDocument || identityPending ? 'PENDING_REVIEW' : 'INCOMPLETE';
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
        provider_calendar: 'Configure availability',
        service_provider_link: 'Configure team links',
        administrator_contacts_verified: 'Verify administrator email',
        owner_identity_verified: 'Declare ownership',
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
