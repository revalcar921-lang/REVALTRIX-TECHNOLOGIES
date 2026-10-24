import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrganizationIdentityReviewStatus,
  OwnershipEvidenceType,
  OwnershipPartyRole,
  OwnershipPartyType,
  Prisma,
  RecordStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import type { ReviewOwnershipPartyDto, SaveOwnershipPartyDto, SubmitOwnershipDeclarationDto, UploadOwnershipEvidenceDto } from './dto/tenant-setup-config.dto.js';

type OwnershipFile = { originalname: string; mimetype: string; buffer: Buffer; size: number };

@Injectable()
export class TenantOwnershipService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async listMine(userId: string) {
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'read' });
    const [parties, compliance, tenant, account] = await Promise.all([
      this.database.client.tenantOwnershipParty.findMany({
        where: { tenantId: context.tenantId },
        select: {
          id: true,
          partyType: true,
          role: true,
          fullName: true,
          registrationNumber: true,
          registrationCountry: true,
          identityDocumentType: true,
          status: true,
          submittedAt: true,
          rejectionReason: true,
          evidence: {
            select: { id: true, evidenceType: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.database.client.organizationCompliance.findUnique({
        where: { tenantId: context.tenantId },
        select: { ownerIdentityStatus: true, ownershipDeclarationAcceptedAt: true },
      }),
      this.database.client.tenant.findUnique({
        where: { id: context.tenantId },
        select: {
          name: true,
          legalName: true,
          profile: { select: { businessName: true, legalName: true, registrationNumber: true, registrationCountry: true, country: true } },
        },
      }),
      this.database.client.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    ]);
    return {
      parties,
      status: compliance?.ownerIdentityStatus ?? 'NOT_STARTED',
      declarationAcceptedAt: compliance?.ownershipDeclarationAcceptedAt ?? null,
      defaults: {
        individualName: account?.displayName ?? '',
        entityName: tenant?.profile?.legalName || tenant?.legalName || tenant?.profile?.businessName || tenant?.name || '',
        registrationNumber: tenant?.profile?.registrationNumber ?? '',
        registrationCountry: tenant?.profile?.registrationCountry || tenant?.profile?.country || 'Kenya',
      },
    };
  }

  async createParty(userId: string, dto: SaveOwnershipPartyDto) {
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'update' });
    this.assertPartyCombination(dto.partyType, dto.role, dto.registrationNumber, dto.identityDocumentType);
    const party = await this.database.client.tenantOwnershipParty.create({
      data: {
        tenantId: context.tenantId,
        partyType: dto.partyType,
        role: dto.role,
        fullName: dto.fullName.trim(),
        registrationNumber: dto.registrationNumber?.trim() || null,
        registrationCountry: dto.registrationCountry?.trim() || null,
        identityDocumentType: dto.identityDocumentType?.trim() || null,
        createdByUserId: userId,
      },
      select: { id: true, partyType: true, role: true, fullName: true, status: true },
    });
    if (dto.role === OwnershipPartyRole.OWNER) {
      await this.database.client.tenantProfile.updateMany({
        where: { tenantId: context.tenantId },
        data: {
          ownershipType: dto.partyType,
          registrationNumber: dto.partyType === OwnershipPartyType.INDIVIDUAL ? null : dto.registrationNumber?.trim() || null,
          registrationCountry: dto.partyType === OwnershipPartyType.INDIVIDUAL ? null : dto.registrationCountry?.trim() || null,
        },
      });
    }
    await this.resetOwnershipReview(context.tenantId);
    await this.audit(context.tenantId, userId, 'TENANT_OWNERSHIP_PARTY_CREATED', party.id, { partyType: dto.partyType, role: dto.role });
    return party;
  }

  async updateParty(userId: string, partyId: string, dto: SaveOwnershipPartyDto) {
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'update' });
    this.assertPartyCombination(dto.partyType, dto.role, dto.registrationNumber, dto.identityDocumentType);
    const existing = await this.database.client.tenantOwnershipParty.findFirst({
      where: { id: partyId, tenantId: context.tenantId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Ownership party not found');
    if (existing.status === OrganizationIdentityReviewStatus.VERIFIED) {
      throw new ConflictException('Verified ownership records cannot be edited; add a replacement party and remove this record.');
    }
    const party = await this.database.client.tenantOwnershipParty.update({
      where: { id: partyId },
      data: {
        partyType: dto.partyType,
        role: dto.role,
        fullName: dto.fullName.trim(),
        registrationNumber: dto.registrationNumber?.trim() || null,
        registrationCountry: dto.registrationCountry?.trim() || null,
        identityDocumentType: dto.identityDocumentType?.trim() || null,
        status: OrganizationIdentityReviewStatus.NOT_STARTED,
        submittedAt: null,
        reviewedAt: null,
        reviewedByUserId: null,
        rejectionReason: null,
      },
      select: { id: true, partyType: true, role: true, fullName: true, status: true },
    });
    await this.resetOwnershipReview(context.tenantId);
    await this.audit(context.tenantId, userId, 'TENANT_OWNERSHIP_PARTY_UPDATED', party.id, { partyType: dto.partyType, role: dto.role });
    return party;
  }

  async removeParty(userId: string, partyId: string) {
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'update' });
    const party = await this.database.client.tenantOwnershipParty.findFirst({
      where: { id: partyId, tenantId: context.tenantId },
      select: { id: true, status: true, evidence: { select: { storageKey: true } } },
    });
    if (!party) throw new NotFoundException('Ownership party not found');
    await this.database.client.tenantOwnershipParty.delete({ where: { id: partyId } });
    await Promise.all(party.evidence.map(({ storageKey }) => this.storage.delete(storageKey).catch(() => undefined)));
    await this.resetOwnershipReview(context.tenantId);
    await this.audit(context.tenantId, userId, 'TENANT_OWNERSHIP_PARTY_REMOVED', party.id, {});
    return { id: party.id, deleted: true };
  }

  async uploadEvidence(userId: string, partyId: string, dto: UploadOwnershipEvidenceDto, file?: OwnershipFile) {
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'update' });
    const party = await this.database.client.tenantOwnershipParty.findFirst({
      where: { id: partyId, tenantId: context.tenantId },
      select: { id: true, partyType: true, status: true },
    });
    if (!party) throw new NotFoundException('Ownership party not found');
    if (party.status === OrganizationIdentityReviewStatus.VERIFIED) throw new ConflictException('Verified parties cannot be changed.');
    this.assertEvidenceAllowed(party.partyType, dto.evidenceType);
    if (!file || file.buffer.length === 0 || file.buffer.length > 10 * 1024 * 1024 || file.size !== file.buffer.length) {
      throw new BadRequestException('Choose a PDF, JPG, or PNG file no larger than 10 MB.');
    }
    const extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
    if (!extensions[file.mimetype] || !this.matchesFileSignature(file.mimetype, file.buffer)) {
      throw new BadRequestException('File content does not match a supported PDF, JPG, or PNG format.');
    }
    if (dto.evidenceType === OwnershipEvidenceType.SELFIE && !file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Selfie evidence must be an image.');
    }
    const fileName = file.originalname.replace(/[\r\n"\\/]/g, '_').slice(0, 255) || `ownership-evidence.${extensions[file.mimetype]}`;
    const storageKey = `tenant/${context.tenantId}/ownership/${party.id}/${randomUUID()}.${extensions[file.mimetype]}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    try {
      const evidence = await this.database.client.tenantOwnershipEvidence.create({
        data: {
          tenantId: context.tenantId,
          partyId,
          evidenceType: dto.evidenceType,
          storageKey,
          fileName,
          contentType: file.mimetype,
          sizeBytes: file.buffer.length,
          uploadedByUserId: userId,
        },
        select: { id: true, evidenceType: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
      });
      await this.audit(context.tenantId, userId, 'TENANT_OWNERSHIP_EVIDENCE_UPLOADED', evidence.id, { partyId, evidenceType: dto.evidenceType });
      return evidence;
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async submitDeclaration(userId: string, dto: SubmitOwnershipDeclarationDto) {
    if (!dto.accepted) throw new BadRequestException('Accept the ownership declaration before submitting.');
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'update' });
    const currentCompliance = await this.database.client.organizationCompliance.findUnique({
      where: { tenantId: context.tenantId },
      select: { ownerIdentityStatus: true },
    });
    if (currentCompliance?.ownerIdentityStatus === OrganizationIdentityReviewStatus.VERIFIED) {
      throw new ConflictException('Ownership has already been verified. Contact the platform reviewer if it has changed.');
    }
    const parties = await this.database.client.tenantOwnershipParty.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, partyType: true, role: true, evidence: { select: { evidenceType: true } } },
    });
    const owner = parties.find((party) => party.role === OwnershipPartyRole.OWNER);
    if (!owner) throw new ConflictException('Add one verified owner party before submitting the declaration.');
    if (parties.filter((party) => party.role === OwnershipPartyRole.OWNER).length !== 1) {
      throw new ConflictException('Declare exactly one accountable owner party.');
    }
    const hasEvidence = (party: typeof parties[number], evidenceType: OwnershipEvidenceType) =>
      party.evidence.some((item) => item.evidenceType === evidenceType);
    if (owner.partyType === OwnershipPartyType.INDIVIDUAL) {
      this.assertIndividualEvidence(owner);
    } else if (owner.partyType === OwnershipPartyType.LEGAL_ENTITY) {
      if (!owner.evidence.some((item) => item.evidenceType === OwnershipEvidenceType.BUSINESS_REGISTRATION)) {
        throw new ConflictException('Upload the company registration document for the owner entity.');
      }
      const directors = parties.filter((party) => party.partyType === OwnershipPartyType.INDIVIDUAL &&
        (party.role === OwnershipPartyRole.DIRECTOR || party.role === OwnershipPartyRole.BENEFICIAL_OWNER));
      if (!directors.length) throw new ConflictException('Add at least one director or beneficial owner.');
      for (const director of directors) this.assertIndividualEvidence(director);
    } else {
      if (!owner.evidence.some((item) => item.evidenceType === OwnershipEvidenceType.GOVERNMENT_AUTHORITY)) {
        throw new ConflictException('Upload a document showing government ownership or authority.');
      }
      const officials = parties.filter((party) => party.partyType === OwnershipPartyType.INDIVIDUAL && party.role === OwnershipPartyRole.AUTHORIZED_OFFICIAL);
      if (!officials.length) throw new ConflictException('Add at least one authorized government official.');
      for (const official of officials) this.assertIndividualEvidence(official);
    }
    await this.database.client.$transaction(async (tx) => {
      await tx.tenantOwnershipParty.updateMany({
        where: { tenantId: context.tenantId },
        data: {
          status: OrganizationIdentityReviewStatus.PENDING_REVIEW,
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedByUserId: null,
          rejectionReason: null,
        },
      });
      await tx.organizationCompliance.upsert({
        where: { tenantId: context.tenantId },
        create: {
          tenantId: context.tenantId,
          ownerIdentityStatus: OrganizationIdentityReviewStatus.PENDING_REVIEW,
          ownershipDeclarationAcceptedAt: new Date(),
          ownershipDeclarationAcceptedByUserId: userId,
        },
        update: {
          ownerIdentityStatus: OrganizationIdentityReviewStatus.PENDING_REVIEW,
          ownerIdentityReviewedAt: null,
          ownerIdentityReviewedBy: null,
          ownerIdentityRejectionReason: null,
          ownershipDeclarationAcceptedAt: new Date(),
          ownershipDeclarationAcceptedByUserId: userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: userId,
          action: 'TENANT_OWNERSHIP_DECLARATION_SUBMITTED',
          resourceType: 'TENANT_OWNERSHIP',
          outcome: 'SUCCESS',
          metadata: { partyCount: parties.length },
        },
      });
    });
    return this.listMine(userId);
  }

  async listPendingReviews() {
    return this.database.client.tenantOwnershipParty.findMany({
      where: { status: OrganizationIdentityReviewStatus.PENDING_REVIEW },
      select: {
        id: true,
        tenantId: true,
        partyType: true,
        role: true,
        fullName: true,
        registrationNumber: true,
        registrationCountry: true,
        identityDocumentType: true,
        submittedAt: true,
        tenant: { select: { name: true, code: true, type: true, profile: { select: { businessName: true, registrationNumber: true, ownershipType: true } } } },
        evidence: { select: { id: true, evidenceType: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ submittedAt: 'asc' }, { tenantId: 'asc' }],
    });
  }

  async canReview(userId: string): Promise<boolean> {
    return this.authorization.hasPlatformPermission(userId, { resource: 'tenant_ownership', action: 'review' });
  }

  async downloadReviewEvidence(reviewerUserId: string, partyId: string, evidenceId: string) {
    const evidence = await this.database.client.tenantOwnershipEvidence.findFirst({
      where: { id: evidenceId, partyId },
      select: { id: true, tenantId: true, storageKey: true, contentType: true, fileName: true },
    });
    if (!evidence) throw new NotFoundException('Ownership evidence not found');
    const buffer = await this.storage.get(evidence.storageKey);
    await this.database.client.auditEvent.create({
      data: {
        tenantId: evidence.tenantId,
        actorUserId: reviewerUserId,
        action: 'TENANT_OWNERSHIP_EVIDENCE_VIEWED',
        resourceType: 'TENANT_OWNERSHIP_EVIDENCE',
        resourceId: evidence.id,
        outcome: 'SUCCESS',
      },
    });
    return { buffer, contentType: evidence.contentType, fileName: evidence.fileName };
  }

  async reviewParty(reviewerUserId: string, partyId: string, dto: ReviewOwnershipPartyDto) {
    if (dto.decision === 'REJECTED' && !dto.reason?.trim()) throw new BadRequestException('A rejection reason is required.');
    const party = await this.database.client.tenantOwnershipParty.findUnique({
      where: { id: partyId },
      select: { id: true, tenantId: true, status: true },
    });
    if (!party) throw new NotFoundException('Ownership party not found');
    if (party.status !== OrganizationIdentityReviewStatus.PENDING_REVIEW) throw new ConflictException('Only pending ownership parties can be reviewed.');
    await this.database.client.$transaction(async (tx) => {
      await tx.tenantOwnershipParty.update({
        where: { id: partyId },
        data: {
          status: dto.decision === 'VERIFIED' ? OrganizationIdentityReviewStatus.VERIFIED : OrganizationIdentityReviewStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedByUserId: reviewerUserId,
          rejectionReason: dto.decision === 'REJECTED' ? dto.reason!.trim() : null,
        },
      });
      const parties = await tx.tenantOwnershipParty.findMany({
        where: { tenantId: party.tenantId },
        select: { status: true },
      });
      const status = parties.length > 0 && parties.every((entry) => entry.status === OrganizationIdentityReviewStatus.VERIFIED)
        ? OrganizationIdentityReviewStatus.VERIFIED
        : parties.some((entry) => entry.status === OrganizationIdentityReviewStatus.REJECTED)
          ? OrganizationIdentityReviewStatus.REJECTED
          : OrganizationIdentityReviewStatus.PENDING_REVIEW;
      await tx.organizationCompliance.upsert({
        where: { tenantId: party.tenantId },
        create: {
          tenantId: party.tenantId,
          ownerIdentityStatus: status,
          ownerIdentityReviewedAt: status === OrganizationIdentityReviewStatus.VERIFIED ? new Date() : null,
          ownerIdentityReviewedBy: status === OrganizationIdentityReviewStatus.VERIFIED ? reviewerUserId : null,
          ownerIdentityRejectionReason: status === OrganizationIdentityReviewStatus.REJECTED ? dto.reason!.trim() : null,
        },
        update: {
          ownerIdentityStatus: status,
          ownerIdentityReviewedAt: status === OrganizationIdentityReviewStatus.VERIFIED ? new Date() : null,
          ownerIdentityReviewedBy: status === OrganizationIdentityReviewStatus.VERIFIED ? reviewerUserId : null,
          ownerIdentityRejectionReason: status === OrganizationIdentityReviewStatus.REJECTED ? dto.reason!.trim() : null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: party.tenantId,
          actorUserId: reviewerUserId,
          action: `TENANT_OWNERSHIP_PARTY_${dto.decision}`,
          resourceType: 'TENANT_OWNERSHIP_PARTY',
          resourceId: partyId,
          outcome: 'SUCCESS',
          metadata: { decision: dto.decision, reason: dto.reason?.trim() ?? null },
        },
      });
    });
    return { id: partyId, decision: dto.decision };
  }

  async deleteReviewEvidence(userId: string, partyId: string, evidenceId: string) {
    const context = await this.authorization.assertPermission(userId, { resource: 'organization', action: 'update' });
    const evidence = await this.database.client.tenantOwnershipEvidence.findFirst({
      where: { id: evidenceId, partyId, tenantId: context.tenantId, party: { status: { not: OrganizationIdentityReviewStatus.VERIFIED } } },
      select: { id: true, storageKey: true },
    });
    if (!evidence) throw new NotFoundException('Editable ownership evidence not found');
    await this.database.client.tenantOwnershipEvidence.delete({ where: { id: evidence.id } });
    await this.storage.delete(evidence.storageKey).catch(() => undefined);
    await this.resetOwnershipReview(context.tenantId);
    return { id: evidence.id, deleted: true };
  }

  private assertPartyCombination(partyType: OwnershipPartyType, role: OwnershipPartyRole, registrationNumber?: string, identityDocumentType?: string) {
    if (partyType !== OwnershipPartyType.INDIVIDUAL && role !== OwnershipPartyRole.OWNER) {
      throw new BadRequestException('Legal and government entities must be listed as the owner party.');
    }
    if (partyType === OwnershipPartyType.INDIVIDUAL) {
      if (!identityDocumentType) throw new BadRequestException('Select an identity document type for each individual.');
      return;
    }
    if (!registrationNumber?.trim()) {
      throw new BadRequestException('Enter the legal registration or government reference number.');
    }
  }

  private assertIndividualEvidence(
    party: { id: string; evidence: Array<{ evidenceType: OwnershipEvidenceType }> },
  ) {
    if (!party.evidence.some((item) => item.evidenceType === OwnershipEvidenceType.IDENTITY_DOCUMENT) ||
      !party.evidence.some((item) => item.evidenceType === OwnershipEvidenceType.SELFIE)) {
      throw new ConflictException(`Upload identity document and selfie evidence for ${party.id}.`);
    }
  }

  private assertEvidenceAllowed(partyType: OwnershipPartyType, evidenceType: OwnershipEvidenceType) {
    if (partyType === OwnershipPartyType.INDIVIDUAL && ![OwnershipEvidenceType.IDENTITY_DOCUMENT, OwnershipEvidenceType.SELFIE].some((allowed) => allowed === evidenceType)) {
      throw new BadRequestException('Individual parties can only upload identity documents and selfies.');
    }
    if (partyType === OwnershipPartyType.LEGAL_ENTITY && ![OwnershipEvidenceType.BUSINESS_REGISTRATION, OwnershipEvidenceType.AUTHORIZATION_LETTER].some((allowed) => allowed === evidenceType)) {
      throw new BadRequestException('Company parties can only upload registration or authorization evidence.');
    }
    if (partyType === OwnershipPartyType.GOVERNMENT_ENTITY && ![OwnershipEvidenceType.GOVERNMENT_AUTHORITY, OwnershipEvidenceType.AUTHORIZATION_LETTER].some((allowed) => allowed === evidenceType)) {
      throw new BadRequestException('Government parties can only upload authority or authorization evidence.');
    }
  }

  private matchesFileSignature(mimeType: string, buffer: Buffer): boolean {
    if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
    if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return false;
  }

  private async resetOwnershipReview(tenantId: string) {
    await this.database.client.organizationCompliance.updateMany({
      where: { tenantId },
      data: {
        ownerIdentityStatus: OrganizationIdentityReviewStatus.NOT_STARTED,
        ownerIdentityReviewedAt: null,
        ownerIdentityReviewedBy: null,
        ownerIdentityRejectionReason: null,
        ownershipDeclarationAcceptedAt: null,
        ownershipDeclarationAcceptedByUserId: null,
      },
    });
  }

  private async audit(tenantId: string, userId: string, action: string, resourceId: string, metadata: Prisma.InputJsonObject) {
    await this.database.client.auditEvent.create({
      data: { tenantId, actorUserId: userId, action, resourceType: 'TENANT_OWNERSHIP', resourceId, outcome: 'SUCCESS', metadata },
    });
  }
}