import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename } from 'node:path';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service.js';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import { VerificationEmailService } from '../communication/email/verification-email.service.js';
import type {
  CreateFamilyAccessGrantDto,
  FlagDependentRegistrationDto,
  ReviewDependentRegistrationDto,
  UpdateFamilyAccessGrantDto,
  UploadFamilyVerificationDocumentDto,
  VerifyFamilyStepUpDto,
} from './dto/create-family-access-grant.dto.js';
import { FAMILY_ACCESS_PERMISSIONS } from './dto/create-family-access-grant.dto.js';

export type AccessPermission = (typeof FAMILY_ACCESS_PERMISSIONS)[number];

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;

function getAge(dateOfBirth: Date, now: Date): number {
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const birthdayNotReached =
    now.getMonth() < dateOfBirth.getMonth() ||
    (now.getMonth() === dateOfBirth.getMonth() && now.getDate() < dateOfBirth.getDate());

  if (birthdayNotReached) age -= 1;
  return age;
}

function toPermissionList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return [];
  }
  return value;
}

@Injectable()
export class FamilyAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly storage: PrivateObjectStorageService,
    private readonly verificationEmail: VerificationEmailService,
  ) {}

  async requestStepUp(userId: string, sessionId: string) {
    const identity = await this.database.client.identity.findFirst({
      where: {
        userId,
        type: 'EMAIL',
        status: 'ACTIVE',
        verifiedAt: { not: null },
      },
      select: { value: true },
      orderBy: { verifiedAt: 'desc' },
    });
    if (!identity) {
      throw new ForbiddenException('A verified email address is required for a security code');
    }

    const target = `session:${sessionId}`;
    const active = await this.database.client.verificationChallenge.findFirst({
      where: {
        userId,
        channel: 'EMAIL',
        purpose: 'FAMILY_ACCESS',
        target,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, expiresAt: true },
    });
    if (active) {
      throw new ConflictException(
        'A security code is already active. Use it or wait for it to expire.',
      );
    }

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const challenge = await this.database.client.verificationChallenge.create({
      data: {
        userId,
        channel: 'EMAIL',
        purpose: 'FAMILY_ACCESS',
        target,
        codeHash: createHash('sha256').update(code).digest('hex'),
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
      },
      select: { id: true, expiresAt: true },
    });

    try {
      await this.verificationEmail.sendFamilyAccessStepUp(identity.value, code, expiresAt);
    } catch {
      await this.database.client.verificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw new ServiceUnavailableException(
        'Security code could not be delivered. Please try again later.',
      );
    }
    return { data: { challengeId: challenge.id, expiresAt: challenge.expiresAt } };
  }

  async verifyStepUp(userId: string, sessionId: string, dto: VerifyFamilyStepUpDto) {
    const now = new Date();
    const challenge = await this.database.client.verificationChallenge.findFirst({
      where: {
        id: dto.challengeId,
        userId,
        channel: 'EMAIL',
        purpose: 'FAMILY_ACCESS',
        target: `session:${sessionId}`,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: 5 },
      },
      select: { id: true, codeHash: true, attempts: true, maxAttempts: true },
    });
    if (!challenge) {
      throw new BadRequestException(
        'Security code is invalid, expired, or has too many failed attempts',
      );
    }

    const submittedHash = createHash('sha256').update(dto.code).digest();
    const expectedHash = Buffer.from(challenge.codeHash, 'hex');
    const valid =
      submittedHash.length === expectedHash.length && timingSafeEqual(submittedHash, expectedHash);
    if (!valid) {
      const updated = await this.database.client.verificationChallenge.updateMany({
        where: {
          id: challenge.id,
          verifiedAt: null,
          consumedAt: null,
          attempts: { lt: challenge.maxAttempts },
        },
        data: { attempts: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          'Security code is invalid, expired, or has too many failed attempts',
        );
      }
      throw new BadRequestException('Security code is incorrect');
    }

    const verified = await this.database.client.verificationChallenge.updateMany({
      where: {
        id: challenge.id,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { verifiedAt: now },
    });
    if (verified.count !== 1) {
      throw new ConflictException('Security code has already been used');
    }
    return { data: { challengeId: challenge.id, verifiedAt: now } };
  }

  async consumeStepUp(userId: string, sessionId: string, challengeId?: string) {
    if (!challengeId) {
      throw new ForbiddenException('Complete the security code check before this action');
    }
    const result = await this.database.client.verificationChallenge.updateMany({
      where: {
        id: challengeId,
        userId,
        channel: 'EMAIL',
        purpose: 'FAMILY_ACCESS',
        target: `session:${sessionId}`,
        verifiedAt: { not: null },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new ForbiddenException(
        'Security code verification is missing, expired, or already used',
      );
    }
  }

  private async patientProfileForUser(userId: string) {
    const profile = await this.database.client.patientProfile.findUnique({
      where: { userId },
      select: { id: true, dateOfBirth: true },
    });
    if (!profile) {
      throw new NotFoundException('Authenticated user is not a Revaltrix patient');
    }
    return profile;
  }

  private async assertCanManagePatient(actorPatientId: string, patientId: string) {
    if (actorPatientId === patientId) return;

    const now = new Date();
    const authority = await this.database.client.patientGuardianAuthority.findFirst({
      where: {
        guardianPatientProfileId: actorPatientId,
        dependentPatientProfileId: patientId,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        dependentPatientProfile: {
          dependentRegistration: { status: 'APPROVED' },
        },
      },
      select: { id: true },
    });
    if (!authority) {
      throw new ForbiddenException(
        'Only the patient or a verified guardian may manage this access grant',
      );
    }
  }

  private async assertAdolescentPolicy(patientId: string, permissions: string[]) {
    const patient = await this.database.client.patientProfile.findUnique({
      where: { id: patientId },
      select: { dateOfBirth: true },
    });
    if (!patient) throw new NotFoundException('Patient was not found');
    if (!patient.dateOfBirth) return;

    const now = new Date();
    const age = getAge(patient.dateOfBirth, now);
    const adolescentMinimumAge = this.config.get<number>('family.adolescentMinimumAge', 13);
    if (age < adolescentMinimumAge || age >= 18) return;

    const restricted = this.config
      .get<string>(
        'family.adolescentRestrictedPermissions',
        'lab-results.read,prescriptions.read,documents.read',
      )
      .split(',')
      .map((permission) => permission.trim())
      .filter(Boolean);

    const restrictedPermissions = permissions.filter((permission) =>
      restricted.includes(permission),
    );
    if (restrictedPermissions.length) {
      throw new ForbiddenException(
        `Adolescent access policy does not allow: ${restrictedPermissions.join(', ')}`,
      );
    }
  }

  private resolveExpiry(value?: string): Date {
    const now = new Date();
    const expiry = value
      ? new Date(value)
      : new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * DAY_IN_MS);
    if (!Number.isFinite(expiry.getTime()) || expiry <= now) {
      throw new BadRequestException('Access expiry must be in the future');
    }
    if (expiry.getTime() > now.getTime() + MAX_EXPIRY_DAYS * DAY_IN_MS) {
      throw new BadRequestException('Access expiry cannot exceed one year');
    }
    return expiry;
  }

  private async writeAudit(input: {
    accessGrantId?: string | null;
    patientId: string;
    delegateId: string;
    action:
      'VIEW' | 'DOWNLOAD' | 'CREATE' | 'UPDATE' | 'CANCEL' | 'LOGIN_ATTEMPT' | 'ACCESS_DENIED';
    resourceType:
      | 'PROFILE'
      | 'APPOINTMENTS'
      | 'REMINDERS'
      | 'DOCUMENTS'
      | 'LAB_RESULTS'
      | 'PRESCRIPTIONS'
      | 'BILLING'
      | 'MESSAGES';
    resourceId?: string;
    request?: Request;
    metadata?: Record<string, string | number | boolean | null>;
  }) {
    await this.database.client.familyAccessAuditLog.create({
      data: {
        accessGrantId: input.accessGrantId ?? null,
        patientId: input.patientId,
        delegateId: input.delegateId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        ipAddress: input.request?.ip?.slice(0, 64) ?? null,
        userAgent: input.request?.headers['user-agent']?.slice(0, 500) ?? null,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }

  async createGrant(userId: string, dto: CreateFamilyAccessGrantDto) {
    const actor = await this.patientProfileForUser(userId);
    if (dto.patientId === dto.delegateId) {
      throw new BadRequestException('A patient cannot delegate access to their own profile');
    }

    const delegate = await this.database.client.patientProfile.findUnique({
      where: { id: dto.delegateId },
      select: { id: true, userId: true },
    });
    if (!delegate) throw new NotFoundException('Delegate was not found');

    await this.assertCanManagePatient(actor.id, dto.patientId);

    const relationship = await this.database.client.patientFamilyRelationship.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { patientProfileId: dto.patientId, relatedPatientProfileId: delegate.id },
          { patientProfileId: delegate.id, relatedPatientProfileId: dto.patientId },
          { patientProfileId: actor.id, relatedPatientProfileId: delegate.id },
          { patientProfileId: delegate.id, relatedPatientProfileId: actor.id },
        ],
      },
      select: { id: true },
    });
    if (!relationship) {
      throw new ForbiddenException('An active family connection to the delegate is required');
    }

    const permissions = [...new Set(dto.permissions)] as AccessPermission[];
    await this.assertAdolescentPolicy(dto.patientId, permissions);
    const expiresAt = this.resolveExpiry(dto.expiresAt);

    const grant = await this.database.client.familyAccessGrant.create({
      data: {
        patientId: dto.patientId,
        delegateId: delegate.id,
        relationshipId: relationship.id,
        permissions,
        status: 'ACTIVE',
        grantedById: userId,
        expiresAt,
      },
    });
    await this.writeAudit({
      accessGrantId: grant.id,
      patientId: grant.patientId,
      delegateId: grant.delegateId,
      action: 'CREATE',
      resourceType: 'PROFILE',
      metadata: { permissionCount: permissions.length },
    });
    return { data: grant };
  }

  async listGrants(userId: string) {
    const actor = await this.patientProfileForUser(userId);
    const now = new Date();
    await this.database.client.familyAccessGrant.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
        OR: [{ patientId: actor.id }, { delegateId: actor.id }],
      },
      data: { status: 'EXPIRED' },
    });
    const grants = await this.database.client.familyAccessGrant.findMany({
      where: {
        OR: [{ patientId: actor.id }, { delegateId: actor.id }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            secondName: true,
            dateOfBirth: true,
          },
        },
        delegate: {
          select: {
            id: true,
            firstName: true,
            secondName: true,
          },
        },
        relationship: { select: { relationshipType: true, status: true } },
        auditLogs: {
          where: { action: { in: ['VIEW', 'DOWNLOAD'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    return {
      data: grants.map(({ auditLogs, ...grant }) => ({
        ...grant,
        permissions: toPermissionList(grant.permissions),
        lastAccessAt: auditLogs[0]?.createdAt ?? null,
        reviewDueAt: new Date(
          (grant.reviewedAt ?? grant.createdAt).getTime() + DEFAULT_EXPIRY_DAYS * DAY_IN_MS,
        ),
      })),
      adolescentPolicy: {
        minimumAge: this.config.get<number>('family.adolescentMinimumAge', 13),
        restrictedPermissions: this.config
          .get<string>(
            'family.adolescentRestrictedPermissions',
            'lab-results.read,prescriptions.read,documents.read',
          )
          .split(',')
          .map((permission) => permission.trim())
          .filter(Boolean),
      },
    };
  }

  async updateGrant(userId: string, grantId: string, dto: UpdateFamilyAccessGrantDto) {
    const actor = await this.patientProfileForUser(userId);
    const grant = await this.database.client.familyAccessGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Access grant was not found');
    await this.assertCanManagePatient(actor.id, grant.patientId);
    if (grant.status !== 'ACTIVE' || grant.expiresAt <= new Date()) {
      throw new ConflictException('Only active access grants can be changed');
    }

    const permissions = dto.permissions
      ? ([...new Set(dto.permissions)] as AccessPermission[])
      : toPermissionList(grant.permissions);
    await this.assertAdolescentPolicy(grant.patientId, permissions);
    const data = {
      permissions,
      ...(dto.expiresAt ? { expiresAt: this.resolveExpiry(dto.expiresAt) } : {}),
    };
    const updated = await this.database.client.familyAccessGrant.update({
      where: { id: grant.id },
      data,
    });
    await this.writeAudit({
      accessGrantId: grant.id,
      patientId: grant.patientId,
      delegateId: grant.delegateId,
      action: 'UPDATE',
      resourceType: 'PROFILE',
      metadata: { permissionCount: permissions.length },
    });
    return { data: updated };
  }

  async revokeGrant(userId: string, grantId: string) {
    const actor = await this.patientProfileForUser(userId);
    const grant = await this.database.client.familyAccessGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Access grant was not found');
    await this.assertCanManagePatient(actor.id, grant.patientId);
    if (grant.status === 'REVOKED') {
      throw new ConflictException('This access grant has already been revoked');
    }
    const revokedAt = new Date();
    const result = await this.database.client.familyAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: 'REVOKED',
        revokedAt,
        revokedById: userId,
      },
    });
    await this.writeAudit({
      accessGrantId: grant.id,
      patientId: grant.patientId,
      delegateId: grant.delegateId,
      action: 'CANCEL',
      resourceType: 'PROFILE',
    });
    return { data: result };
  }

  async grantActivity(userId: string, grantId: string) {
    const actor = await this.patientProfileForUser(userId);
    const grant = await this.database.client.familyAccessGrant.findUnique({
      where: { id: grantId },
      select: { id: true, patientId: true, delegateId: true },
    });
    if (!grant) throw new NotFoundException('Access grant was not found');
    if (actor.id !== grant.patientId && actor.id !== grant.delegateId) {
      throw new NotFoundException('Access grant was not found');
    }

    return {
      data: await this.database.client.familyAccessAuditLog.findMany({
        where: { accessGrantId: grant.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    };
  }

  async reviewGrant(userId: string, grantId: string) {
    const actor = await this.patientProfileForUser(userId);
    const grant = await this.database.client.familyAccessGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Access grant was not found');
    await this.assertCanManagePatient(actor.id, grant.patientId);
    const reviewedAt = new Date();
    const result = await this.database.client.familyAccessGrant.update({
      where: { id: grant.id },
      data: { reviewedAt },
    });
    await this.writeAudit({
      accessGrantId: grant.id,
      patientId: grant.patientId,
      delegateId: grant.delegateId,
      action: 'UPDATE',
      resourceType: 'PROFILE',
      metadata: { event: 'ACCESS_REVIEW' },
    });
    return { data: result };
  }

  async auditLogs(userId: string) {
    const actor = await this.patientProfileForUser(userId);
    return {
      data: await this.database.client.familyAccessAuditLog.findMany({
        where: {
          OR: [{ patientId: actor.id }, { delegateId: actor.id }],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    };
  }

  async assertPermission(input: {
    delegateUserId: string;
    patientId: string;
    permission: AccessPermission;
    resourceType:
      | 'PROFILE'
      | 'APPOINTMENTS'
      | 'REMINDERS'
      | 'DOCUMENTS'
      | 'LAB_RESULTS'
      | 'PRESCRIPTIONS'
      | 'BILLING'
      | 'MESSAGES';
    action?: 'VIEW' | 'DOWNLOAD' | 'CREATE' | 'UPDATE' | 'CANCEL';
    resourceId?: string;
    request?: Request;
  }) {
    const [delegate, patient] = await Promise.all([
      this.database.client.patientProfile.findUnique({
        where: { userId: input.delegateUserId },
        select: { id: true },
      }),
      this.database.client.patientProfile.findUnique({
        where: { id: input.patientId },
        select: { id: true },
      }),
    ]);
    if (!delegate || !patient) {
      throw new ForbiddenException('Family access is not authorized');
    }

    const now = new Date();
    const grant = await this.database.client.familyAccessGrant.findFirst({
      where: {
        patientId: patient.id,
        delegateId: delegate.id,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    const permissions = grant ? toPermissionList(grant.permissions) : [];
    const allowed =
      Boolean(grant) &&
      permissions.includes(input.permission) &&
      (await this.policyAllows(patient.id, input.permission));

    await this.writeAudit({
      ...(grant ? { accessGrantId: grant.id } : {}),
      patientId: patient.id,
      delegateId: delegate.id,
      action: allowed ? (input.action ?? 'VIEW') : 'ACCESS_DENIED',
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.request ? { request: input.request } : {}),
      metadata: { permission: input.permission },
    });
    if (!allowed) {
      throw new ForbiddenException('Family access is not authorized');
    }
    return grant!;
  }

  private async policyAllows(patientId: string, permission: AccessPermission) {
    try {
      await this.assertAdolescentPolicy(patientId, [permission]);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  async uploadDependentDocument(
    userId: string,
    registrationId: string,
    dto: UploadFamilyVerificationDocumentDto,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    const registration = await this.database.client.patientDependentRegistration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        registeredByUserId: true,
        registeredByPatientProfileId: true,
        dependentPatientProfileId: true,
        status: true,
      },
    });
    if (!registration || registration.registeredByUserId !== userId) {
      throw new NotFoundException('Dependent registration was not found');
    }
    if (!['DRAFT', 'REJECTED', 'PENDING_REVIEW'].includes(registration.status)) {
      throw new ConflictException('Documents cannot be changed after approval');
    }
    if (file.buffer.length === 0 || file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Verification documents must be 10 MB or smaller');
    }

    const contentSignatures: Record<string, Buffer> = {
      'application/pdf': Buffer.from('%PDF-'),
      'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
    };
    const signature = contentSignatures[file.mimetype];
    if (!signature || !file.buffer.subarray(0, signature.length).equals(signature)) {
      throw new BadRequestException(
        'Only valid PDF, PNG, or JPEG verification documents are accepted',
      );
    }

    const safeFileName = basename(file.originalname)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 255);
    if (!safeFileName) {
      throw new BadRequestException('The uploaded file name is invalid');
    }
    const storageKey = `family-verification/${registration.registeredByPatientProfileId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    try {
      const document = await this.database.client.$transaction(async (tx) => {
        await tx.familyVerificationDocument.updateMany({
          where: {
            dependentRegistrationId: registration.id,
            documentType: dto.documentType,
            status: { in: ['PENDING', 'REJECTED'] },
          },
          data: {
            status: 'REJECTED',
            rejectionReason: 'Superseded by a replacement upload',
          },
        });

        const created = await tx.familyVerificationDocument.create({
          data: {
            ownerId:
              dto.documentType === 'BIRTH_CERTIFICATE'
                ? registration.dependentPatientProfileId
                : registration.registeredByPatientProfileId,
            uploadedById: userId,
            documentType: dto.documentType,
            storageKey,
            fileName: safeFileName,
            mimeType: file.mimetype,
            fileSize: BigInt(file.buffer.length),
            dependentRegistrationId: registration.id,
          },
          select: {
            id: true,
            documentType: true,
            status: true,
            fileName: true,
            fileSize: true,
            createdAt: true,
          },
        });

        const currentDocuments = await tx.familyVerificationDocument.findMany({
          where: {
            dependentRegistrationId: registration.id,
            status: 'PENDING',
          },
          select: { documentType: true, storageKey: true },
        });
        const birthCertificate = currentDocuments.find(
          (item) => item.documentType === 'BIRTH_CERTIFICATE',
        );
        const guardianId = currentDocuments.find((item) =>
          ['NATIONAL_ID', 'PASSPORT'].includes(item.documentType),
        );
        const allRequiredDocumentsUploaded = Boolean(birthCertificate && guardianId);

        await tx.patientDependentRegistration.update({
          where: { id: registration.id },
          data: {
            status: allRequiredDocumentsUploaded ? 'PENDING_REVIEW' : 'DRAFT',
            birthCertificateUrl: birthCertificate?.storageKey ?? null,
            guardianIdDocumentUrl: guardianId?.storageKey ?? null,
            additionalProofUrl:
              currentDocuments.find((item) =>
                ['GUARDIANSHIP_ORDER', 'SCHOOL_ID', 'IMMUNIZATION_CARD', 'OTHER'].includes(
                  item.documentType,
                ),
              )?.storageKey ?? null,
            verificationNotes: null,
            reviewedAt: null,
            reviewedByUserId: null,
          },
        });
        await tx.patientGuardianAuthority.updateMany({
          where: {
            guardianPatientProfileId: registration.registeredByPatientProfileId,
            dependentPatientProfileId: registration.dependentPatientProfileId,
          },
          data: {
            status: 'SUSPENDED',
            verificationStatus: 'PENDING',
            verifiedAt: null,
            verifiedByUserId: null,
          },
        });
        return {
          ...created,
          fileSize: created.fileSize.toString(),
          status: allRequiredDocumentsUploaded ? 'PENDING_REVIEW' : 'DRAFT',
        };
      });
      return { data: document };
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async dependentStatus(userId: string, registrationId: string) {
    const registration = await this.database.client.patientDependentRegistration.findUnique({
      where: { id: registrationId },
      include: {
        dependentPatientProfile: { select: { userId: true } },
        verificationDocuments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            documentType: true,
            fileName: true,
            fileSize: true,
            status: true,
            rejectionReason: true,
            createdAt: true,
          },
        },
      },
    });
    if (
      !registration ||
      (registration.registeredByUserId !== userId &&
        registration.dependentPatientProfile.userId !== userId)
    ) {
      throw new NotFoundException('Dependent registration was not found');
    }
    return {
      data: {
        id: registration.id,
        status: registration.status,
        verificationNotes: registration.verificationNotes,
        reviewedAt: registration.reviewedAt,
        createdAt: registration.createdAt,
        updatedAt: registration.updatedAt,
        documents: registration.verificationDocuments.map((document) => ({
          ...document,
          fileSize: document.fileSize.toString(),
        })),
      },
    };
  }

  async listPendingDependents(search?: string) {
    const query = search?.trim();
    const where = {
      status: 'PENDING_REVIEW' as const,
      ...(query
        ? {
            OR: [
              { id: query },
              {
                dependentPatientProfile: {
                  OR: [
                    { firstName: { contains: query, mode: 'insensitive' as const } },
                    { secondName: { contains: query, mode: 'insensitive' as const } },
                    { platformPatientId: { contains: query, mode: 'insensitive' as const } },
                  ],
                },
              },
              {
                registeredByPatientProfile: {
                  OR: [
                    { firstName: { contains: query, mode: 'insensitive' as const } },
                    { secondName: { contains: query, mode: 'insensitive' as const } },
                    { platformPatientId: { contains: query, mode: 'insensitive' as const } },
                  ],
                },
              },
              {
                registeredByUser: {
                  identities: {
                    some: {
                      value: { contains: query, mode: 'insensitive' as const },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const registrations = await this.database.client.patientDependentRegistration.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        dependentPatientProfile: {
          select: {
            id: true,
            platformPatientId: true,
            firstName: true,
            secondName: true,
            dateOfBirth: true,
          },
        },
        registeredByPatientProfile: {
          select: {
            id: true,
            platformPatientId: true,
            firstName: true,
            secondName: true,
          },
        },
        verificationDocuments: {
          where: { status: 'PENDING' },
          select: {
            id: true,
            documentType: true,
            fileName: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
    });
    return {
      data: registrations.map((registration) => ({
        ...registration,
        verificationDocuments: registration.verificationDocuments.map((document) => ({
          ...document,
          fileSize: document.fileSize.toString(),
        })),
      })),
    };
  }

  async downloadVerificationDocument(
    documentId: string,
    registrationId: string,
    reviewerUserId: string,
  ) {
    const document = await this.database.client.familyVerificationDocument.findFirst({
      where: {
        id: documentId,
        dependentRegistrationId: registrationId,
        status: 'PENDING',
        dependentRegistration: { status: 'PENDING_REVIEW' },
      },
      select: {
        ownerId: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
      },
    });
    if (!document) {
      throw new NotFoundException('Pending verification document was not found');
    }
    const buffer = await this.storage.get(document.storageKey);
    await this.database.client.auditEvent.create({
      data: {
        tenantId: null,
        actorUserId: reviewerUserId,
        action: 'PATIENT_FAMILY_VERIFICATION_DOCUMENT_VIEWED',
        resourceType: 'FAMILY_VERIFICATION_DOCUMENT',
        resourceId: documentId,
        outcome: 'SUCCESS',
        metadata: { ownerPatientProfileId: document.ownerId },
      },
    });
    return {
      buffer,
      fileName: document.fileName,
      contentType: document.mimeType,
      byteSize: document.fileSize.toString(),
    };
  }

  async reviewDependent(
    reviewerUserId: string,
    registrationId: string,
    dto: ReviewDependentRegistrationDto,
  ) {
    const registration = await this.database.client.patientDependentRegistration.findUnique({
      where: { id: registrationId },
      include: {
        verificationDocuments: {
          where: { status: 'PENDING' },
          select: { id: true, documentType: true },
        },
      },
    });
    if (!registration || registration.status !== 'PENDING_REVIEW') {
      throw new NotFoundException('Pending dependent registration was not found');
    }

    const now = new Date();
    if (dto.decision === 'APPROVE') {
      const types = registration.verificationDocuments.map((document) => document.documentType);
      if (
        !types.includes('BIRTH_CERTIFICATE') ||
        !types.some((type) => type === 'NATIONAL_ID' || type === 'PASSPORT')
      ) {
        throw new ConflictException(
          'A birth certificate and guardian national ID or passport are required before approval',
        );
      }
      await this.database.client.$transaction(async (tx) => {
        await tx.patientDependentRegistration.update({
          where: { id: registration.id },
          data: {
            status: 'APPROVED',
            reviewedByUserId: reviewerUserId,
            reviewedAt: now,
            verificationNotes: null,
          },
        });
        await tx.familyVerificationDocument.updateMany({
          where: { id: { in: registration.verificationDocuments.map((doc) => doc.id) } },
          data: { status: 'VERIFIED', reviewedById: reviewerUserId, reviewedAt: now },
        });
        await tx.patientGuardianAuthority.updateMany({
          where: {
            guardianPatientProfileId: registration.registeredByPatientProfileId,
            dependentPatientProfileId: registration.dependentPatientProfileId,
          },
          data: {
            status: 'ACTIVE',
            verificationStatus: 'VERIFIED',
            verifiedByUserId: reviewerUserId,
            verifiedAt: now,
            verificationReason: 'Dependent registration documents approved',
          },
        });
        await tx.patientFamilyRelationship.updateMany({
          where: {
            patientProfileId: registration.registeredByPatientProfileId,
            relatedPatientProfileId: registration.dependentPatientProfileId,
            status: 'ACTIVE',
          },
          data: { verificationStatus: 'VERIFIED', approvedById: reviewerUserId },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: null,
            actorUserId: reviewerUserId,
            action: 'PATIENT_DEPENDENT_VERIFICATION_APPROVED',
            resourceType: 'PATIENT_DEPENDENT_REGISTRATION',
            resourceId: registration.id,
            outcome: 'SUCCESS',
          },
        });
      });
    } else {
      const reason = dto.rejectionReason?.trim();
      if (!reason) {
        throw new BadRequestException('A reason is required when rejecting verification');
      }
      await this.database.client.$transaction(async (tx) => {
        await tx.patientDependentRegistration.update({
          where: { id: registration.id },
          data: {
            status: 'REJECTED',
            reviewedByUserId: reviewerUserId,
            reviewedAt: now,
            verificationNotes: reason,
          },
        });
        await tx.familyVerificationDocument.updateMany({
          where: {
            dependentRegistrationId: registration.id,
            status: 'PENDING',
          },
          data: {
            status: 'REJECTED',
            reviewedById: reviewerUserId,
            reviewedAt: now,
            rejectionReason: reason,
          },
        });
        await tx.patientGuardianAuthority.updateMany({
          where: {
            guardianPatientProfileId: registration.registeredByPatientProfileId,
            dependentPatientProfileId: registration.dependentPatientProfileId,
          },
          data: {
            status: 'SUSPENDED',
            verificationStatus: 'REJECTED',
            verificationReason: reason,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: null,
            actorUserId: reviewerUserId,
            action: 'PATIENT_DEPENDENT_VERIFICATION_REJECTED',
            resourceType: 'PATIENT_DEPENDENT_REGISTRATION',
            resourceId: registration.id,
            outcome: 'SUCCESS',
            reason,
          },
        });
      });
    }
    return this.dependentStatus(registration.registeredByUserId, registration.id);
  }

  async flagDependentRegistration(
    reviewerUserId: string,
    registrationId: string,
    dto: FlagDependentRegistrationDto,
  ) {
    const registration = await this.database.client.patientDependentRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true, status: true },
    });
    if (!registration || registration.status !== 'PENDING_REVIEW') {
      throw new NotFoundException('Pending dependent registration was not found');
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('A flag reason is required');
    const updated = await this.database.client.patientDependentRegistration.update({
      where: { id: registration.id },
      data: { verificationNotes: `Reviewer flag: ${reason}` },
      select: {
        id: true,
        status: true,
        verificationNotes: true,
        updatedAt: true,
      },
    });
    await this.database.client.auditEvent.create({
      data: {
        tenantId: null,
        actorUserId: reviewerUserId,
        action: 'PATIENT_DEPENDENT_VERIFICATION_FLAGGED',
        resourceType: 'PATIENT_DEPENDENT_REGISTRATION',
        resourceId: registration.id,
        outcome: 'SUCCESS',
        reason,
      },
    });
    return { data: updated };
  }
}
