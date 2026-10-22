import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IdentityType,
  Prisma,
  RegistrationStatus,
  RegistrationType,
  StaffStatus,
  VerificationPurpose,
  VerificationStatus,
} from '@prisma/client';
import { createCipheriv, createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { DatabaseService } from '../../database/database.service.js';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { VerificationEmailService } from '../communication/email/verification-email.service.js';
import type { CreateStaffDto } from './dto/create-staff.dto.js';
import type { AssignStaffDepartmentDto } from './dto/assign-staff-department.dto.js';
import type { CreateStaffShiftDto } from './dto/create-staff-shift.dto.js';
import type { UploadStaffDocumentDto } from './dto/upload-staff-document.dto.js';
import type { ReviewStaffDocumentDto } from './dto/review-staff-document.dto.js';
import type { CreateStaffTimeOffDto } from './dto/create-staff-time-off.dto.js';
import type { ReviewStaffTimeOffDto } from './dto/review-staff-time-off.dto.js';
import type { UpdateStaffDto } from './dto/update-staff.dto.js';

function isMissingStoredObject(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === 'ENOENT') return true;
  if ('name' in error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return true;
  if ('$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null) {
    return (
      'httpStatusCode' in error.$metadata &&
      error.$metadata.httpStatusCode === 404
    );
  }
  return false;
}

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly verificationService: VerificationService,
    private readonly verificationEmailService: VerificationEmailService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async list(userId: string) {
    const tenantId = await this.getTenantIdForUser(userId);
    const scopeWhere = await this.getStaffScopeWhere(userId, tenantId);
    const staff = await this.database.client.staffProfile.findMany({
      where: {
        tenantId,
        ...scopeWhere,
      },
      select: {
        id: true,
        hospitalId: true,
        departmentId: true,
        branchId: true,
        reportsToId: true,
        staffNumber: true,
        firstName: true,
        middleName: true,
        lastName: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        gender: true,
        dateOfBirth: true,
        nationalIdEncrypted: true,
        nationality: true,
        physicalAddress: true,
        profilePhotoKey: true,
        jobTitle: true,
        employmentType: true,
        professionalCategory: true,
        licenseNumber: true,
        specialty: true,
        subSpecialty: true,
        licensingBody: true,
        licenseExpiresAt: true,
        qualifications: true,
        yearsExperience: true,
        languages: true,
        consultationFee: true,
        telehealthEnabled: true,
        acceptsOnlineBookings: true,
        acceptsNewPatients: true,
        professionalBio: true,
        professionalLinks: true,
        verificationStatus: true,
        invitationStatus: true,
        invitationExpiresAt: true,
        status: true,
        joinedAt: true,
        createdAt: true,
        updatedAt: true,
        branch: { select: { id: true, name: true, code: true } },
        reportsTo: { select: { id: true, firstName: true, lastName: true } },
        user: {
          select: {
            identities: {
              where: {
                type: { in: [IdentityType.EMAIL, IdentityType.PHONE] },
                status: 'ACTIVE',
              },
              select: {
                type: true,
                normalizedValue: true,
                verifiedAt: true,
                credentialHash: true,
              },
            },
            registrations: {
              where: { tenantId, type: RegistrationType.TENANT },
              select: { status: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        assignments: {
          select: {
            id: true,
            role: true,
            accessLevel: true,
            isPrimaryDepartment: true,
            canAccessDashboard: true,
            startsAt: true,
            endsAt: true,
            assignedById: true,
            assignedAt: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            department: {
              select: {
                id: true,
                name: true,
                code: true,
                status: true,
                requiresDepartmentPassword: true,
              },
            },
            branch: { select: { id: true, name: true, code: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
        services: {
          select: {
            service: {
              select: { id: true, name: true, code: true, departmentId: true, branchId: true, durationMin: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        shifts: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            staffProfileId: true,
            departmentId: true,
            branchId: true,
            shiftName: true,
            startTime: true,
            endTime: true,
            breakStartTime: true,
            breakEndTime: true,
            daysOfWeek: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            department: { select: { id: true, name: true, code: true } },
            branch: { select: { id: true, name: true, code: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return staff.map(({ user, nationalIdEncrypted, profilePhotoKey, services, ...profile }) => {
      const emailIdentity = user.identities.find((identity) =>
        identity.type === IdentityType.EMAIL && identity.normalizedValue === profile.email.trim().toLowerCase(),
      );
      const phoneIdentity = user.identities.find((identity) =>
        identity.type === IdentityType.PHONE && identity.normalizedValue === profile.phone?.trim().replace(/[^\d+]/g, ''),
      );
      return {
        ...profile,
        nationalId: nationalIdEncrypted ? 'On file' : null,
        profilePhotoUrl: null,
        hasProfilePhoto: Boolean(profilePhotoKey),
        services: services.map((assignment) => assignment.service),
        emailVerified: Boolean(emailIdentity?.verifiedAt),
        passwordConfigured: Boolean(emailIdentity?.credentialHash),
        verificationStatus: emailIdentity?.verifiedAt
          ? profile.verificationStatus === 'EMAIL_PENDING'
            ? 'EMAIL_VERIFIED'
            : profile.verificationStatus
          : 'EMAIL_PENDING',
        invitationStatus: emailIdentity?.credentialHash
          ? 'ACCEPTED'
          : profile.invitationExpiresAt && profile.invitationExpiresAt < new Date()
            ? 'EXPIRED'
            : profile.invitationStatus,
        registrationStatus: user.registrations[0]?.status ?? null,
        phoneVerified: Boolean(phoneIdentity?.verifiedAt),
      };
    });
  }

  async requestContactVerification(userId: string, staffProfileId: string, channel: 'EMAIL' | 'PHONE') {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: { in: [StaffStatus.ACTIVE, StaffStatus.INVITED] } },
      select: { userId: true, email: true, phone: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const value = channel === IdentityType.EMAIL ? staff.email : staff.phone;
    if (!value?.trim()) throw new BadRequestException(`No ${channel.toLowerCase()} is saved for this staff member`);
    const normalizedValue = channel === IdentityType.EMAIL
      ? value.trim().toLowerCase()
      : value.trim().replace(/[^\d+]/g, '');
    const existing = await this.database.client.identity.findUnique({
      where: { type_normalizedValue: { type: channel, normalizedValue } },
      select: { id: true, userId: true, verifiedAt: true, status: true },
    });
    if (existing && existing.userId !== staff.userId) {
      throw new ConflictException('This contact method belongs to another account');
    }
    if (existing?.verifiedAt && existing.status === 'ACTIVE') {
      throw new BadRequestException(`${channel === IdentityType.EMAIL ? 'Email' : 'Phone'} is already verified`);
    }

    await this.database.client.identity.upsert({
      where: { type_normalizedValue: { type: channel, normalizedValue } },
      create: {
        userId: staff.userId,
        type: channel,
        value: value.trim(),
        normalizedValue,
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE', value: value.trim(), verifiedAt: null },
    });
    const challenge = await this.verificationService.createRegistrationVerification(staff.userId, channel);
    await this.database.client.auditEvent.create({
      data: {
        tenantId,
        actorUserId: userId,
        action: 'staff.contact_verification.requested',
        resourceType: 'staff_profile',
        resourceId: staffProfileId,
        outcome: 'SUCCESS',
        metadata: { channel, challengeId: challenge.challengeId },
      },
    });
    return challenge;
  }

  async verifyContact(userId: string, staffProfileId: string, challengeId: string, code: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: { in: [StaffStatus.ACTIVE, StaffStatus.INVITED] } },
      select: { userId: true, email: true, phone: true, branchId: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    const challenge = await this.database.client.verificationChallenge.findFirst({
      where: { id: challengeId, userId: staff.userId, purpose: VerificationPurpose.REGISTRATION },
      select: { channel: true, target: true },
    });
    if (!challenge) throw new NotFoundException('Verification challenge not found');
    const currentValue = challenge.channel === 'EMAIL' ? staff.email : staff.phone;
    const currentTarget = challenge.channel === 'EMAIL'
      ? currentValue?.trim().toLowerCase()
      : currentValue?.trim().replace(/[^\d+]/g, '');
    if (!currentTarget || currentTarget !== challenge.target) {
      throw new BadRequestException('This code was sent to a previous contact value. Request a new code.');
    }
    const result = await this.verificationService.verifyRegistrationCode(staff.userId, challengeId, code);
    await this.database.client.identity.updateMany({
      where: {
        userId: staff.userId,
        type: challenge.channel,
        normalizedValue: { not: challenge.target },
        status: 'ACTIVE',
      },
      data: { status: 'INACTIVE', verifiedAt: null },
    });
    await this.database.client.auditEvent.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId: staff.branchId,
        action: 'staff.contact_verification.completed',
        resourceType: 'staff_profile',
        resourceId: staffProfileId,
        outcome: 'SUCCESS',
        metadata: { channel: challenge.channel },
      },
    });
    return result;
  }

  async getStaffProfile(userId: string, staffProfileId: string) {
    const members = await this.list(userId);
    const member = members.find((entry) => entry.id === staffProfileId);
    if (!member) throw new NotFoundException('Staff member not found');
    return member;
  }

  async getAnalytics(userId: string) {
    const members = await this.list(userId);
    const protectedDepartments = new Set(
      members.flatMap((member) =>
        member.assignments
          .filter((assignment) => assignment.department.requiresDepartmentPassword)
          .map((assignment) => assignment.department.id),
      ),
    ).size;
    const todayCode = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()] ?? 'MON';
    const emailVerified = members.filter((member) => member.emailVerified).length;
    const active = members.filter((member) => member.status === 'ACTIVE').length;
    return {
      totalStaff: members.length,
      activeStaff: active,
      emailVerified,
      awaitingVerification: members.length - emailVerified,
      pendingInvitations: members.filter((member) => member.status === StaffStatus.INVITED).length,
      protectedDepartments,
      clinicians: members.filter((member) => member.professionalCategory && !['ADMIN', 'RECEPTIONIST', 'OTHER'].includes(member.professionalCategory)).length,
      onDutyToday: members.filter((member) => member.status === 'ACTIVE' && member.shifts.some((shift) => Array.isArray(shift.daysOfWeek) && shift.daysOfWeek.includes(todayCode))).length,
      suspendedOrOffboarded: members.filter((member) => ['SUSPENDED', 'OFFBOARDED'].includes(member.status)).length,
      byProfessionalCategory: Object.fromEntries(
        [...new Set(members.map((member) => member.professionalCategory).filter(Boolean))].map((category) => [
          category,
          members.filter((member) => member.professionalCategory === category).length,
        ]),
      ),
    };
  }

  async updateProfile(userId: string, staffProfileId: string, dto: UpdateStaffDto) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: { not: StaffStatus.OFFBOARDED } },
      select: {
        id: true,
        userId: true,
        firstName: true,
        middleName: true,
        lastName: true,
        professionalCategory: true,
        licenseNumber: true,
        licenseExpiresAt: true,
        branchId: true,
        departmentId: true,
        assignments: {
          where: { status: 'ACTIVE' },
          select: { departmentId: true, branchId: true },
        },
      },
    });
    if (!profile) throw new NotFoundException('Staff member not found');
    if (dto.reportsToId) {
      if (dto.reportsToId === staffProfileId) {
        throw new BadRequestException('A staff member cannot report to themselves');
      }
      await this.assertStaffInScope(userId, tenantId, dto.reportsToId);
      const manager = await this.database.client.staffProfile.findFirst({
        where: { id: dto.reportsToId, tenantId, status: StaffStatus.ACTIVE },
        select: { id: true },
      });
      if (!manager) throw new NotFoundException('Reporting manager not found in this organization');
    }
    const serviceIds = dto.serviceIds === undefined ? undefined : [...new Set(dto.serviceIds)];
    if (serviceIds && serviceIds.length !== dto.serviceIds?.length) {
      throw new BadRequestException('A service can only be assigned once');
    }
    if (serviceIds?.length) {
      const services = await this.database.client.service.findMany({
        where: { id: { in: serviceIds }, tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, departmentId: true, branchId: true },
      });
      if (services.length !== serviceIds.length) {
        throw new NotFoundException('One or more selected services are unavailable in this organization');
      }
      for (const service of services) {
        if (service.departmentId && !profile.assignments.some((assignment) => assignment.departmentId === service.departmentId)) {
          throw new BadRequestException('Selected services must belong to an assigned department');
        }
        if (service.branchId && !profile.assignments.some((assignment) => assignment.branchId === service.branchId)) {
          throw new BadRequestException('Selected services must belong to an assigned branch');
        }
        await this.assertDepartmentInScope(
          userId,
          tenantId,
          service.departmentId ?? profile.departmentId ?? '',
          service.branchId ?? profile.branchId,
        );
      }
    }
    const data: Prisma.StaffProfileUncheckedUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.middleName !== undefined) data.middleName = dto.middleName.trim() || null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.whatsappNumber !== undefined) data.whatsappNumber = dto.whatsappNumber.trim() || null;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.nationalId !== undefined) data.nationalIdEncrypted = this.encryptNationalId(dto.nationalId);
    if (dto.nationality !== undefined) data.nationality = dto.nationality.trim() || null;
    if (dto.physicalAddress !== undefined) data.physicalAddress = dto.physicalAddress.trim() || null;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle.trim() || null;
    if (dto.employmentType !== undefined) data.employmentType = dto.employmentType;
    if (dto.reportsToId !== undefined) data.reportsToId = dto.reportsToId;
    if (dto.professionalCategory !== undefined) data.professionalCategory = dto.professionalCategory;
    if (dto.licenseNumber !== undefined) data.licenseNumber = dto.licenseNumber.trim() || null;
    if (dto.specialty !== undefined) data.specialty = dto.specialty.trim() || null;
    if (dto.subSpecialty !== undefined) data.subSpecialty = dto.subSpecialty.trim() || null;
    if (dto.licensingBody !== undefined) data.licensingBody = dto.licensingBody.trim() || null;
    if (dto.licenseExpiresAt !== undefined) data.licenseExpiresAt = new Date(dto.licenseExpiresAt);
    if (dto.qualifications !== undefined) data.qualifications = dto.qualifications.trim() || null;
    if (dto.yearsExperience !== undefined) data.yearsExperience = dto.yearsExperience;
    if (dto.languages !== undefined) data.languages = dto.languages.map((language) => language.trim()).filter(Boolean);
    if (dto.consultationFee !== undefined) data.consultationFee = dto.consultationFee;
    if (dto.telehealthEnabled !== undefined) data.telehealthEnabled = dto.telehealthEnabled;
    if (dto.acceptsOnlineBookings !== undefined) data.acceptsOnlineBookings = dto.acceptsOnlineBookings;
    if (dto.acceptsNewPatients !== undefined) data.acceptsNewPatients = dto.acceptsNewPatients;
    if (dto.professionalBio !== undefined) data.professionalBio = dto.professionalBio.trim() || null;
    if (dto.professionalLinks !== undefined) data.professionalLinks = dto.professionalLinks;

    return this.database.client.$transaction(async (tx) => {
      const updated = await tx.staffProfile.update({
        where: { id: staffProfileId },
        data,
        select: { id: true, updatedAt: true },
      });
      if (serviceIds) {
        await tx.staffServiceAssignment.deleteMany({ where: { staffProfileId } });
        if (serviceIds.length) {
          await tx.staffServiceAssignment.createMany({
            data: serviceIds.map((serviceId) => ({ staffProfileId, serviceId, assignedById: userId })),
          });
        }
      }
      const firstName = dto.firstName?.trim() ?? profile.firstName;
      const lastName = dto.lastName?.trim() ?? profile.lastName;
      if (dto.firstName !== undefined || dto.lastName !== undefined || dto.middleName !== undefined) {
        const middleName = dto.middleName?.trim() ?? profile.middleName;
        await tx.user.update({
          where: { id: profile.userId },
          data: { displayName: [firstName, middleName, lastName].filter(Boolean).join(' ') },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: profile.branchId,
          action: 'staff.profile.updated',
          resourceType: 'staff_profile',
          resourceId: staffProfileId,
          outcome: 'SUCCESS',
          metadata: { changedFields: Object.keys(dto) },
        },
      });
      return updated;
    });
  }

  async getMyProfile(userId: string) {
    const profile = await this.database.client.staffProfile.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        tenant: {
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
      select: {
        id: true,
        tenantId: true,
        staffNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        jobTitle: true,
        status: true,
        tenant: { select: { id: true, name: true } },
        assignments: {
          where: {
            status: 'ACTIVE',
            department: {
              status: 'ACTIVE',
              deletedAt: null,
            },
          },
          select: {
            id: true,
            role: true,
            accessLevel: true,
            isPrimaryDepartment: true,
            department: {
              select: {
                id: true,
                name: true,
                code: true,
                type: true,
                category: true,
                requiresDepartmentPassword: true,
              },
            },
          },
          orderBy: [{ isPrimaryDepartment: 'desc' }, { assignedAt: 'asc' }],
        },
      },
    });

    if (!profile) {
      return { profile: null, assignments: [] };
    }

    return {
      profile: {
        id: profile.id,
        staffNumber: profile.staffNumber,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        jobTitle: profile.jobTitle,
        status: profile.status,
        tenant: profile.tenant,
      },
      assignments: profile.assignments,
    };
  }

  async create(userId: string, dto: CreateStaffDto) {
    const tenantId = await this.getTenantIdForUser(userId);
    const email = dto.email.trim();
    const normalizedEmail = email.toLowerCase();
    const department = await this.database.client.department.findFirst({
      where: {
        id: dto.departmentId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        branchId: true,
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found in this organization');
    }

    if (dto.reportsToId) {
      await this.assertStaffInScope(userId, tenantId, dto.reportsToId);
      const manager = await this.database.client.staffProfile.findFirst({
        where: {
          id: dto.reportsToId,
          tenantId,
          status: StaffStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!manager) {
        throw new NotFoundException('Reporting manager not found in this organization');
      }
    }

    const branchId = dto.branchId ?? department.branchId ?? null;
    if (branchId) {
      const branch = await this.database.client.branch.findFirst({
        where: {
          id: branchId,
          tenantId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException('Branch not found in this organization');
      }
    }
    await this.assertDepartmentInScope(userId, tenantId, department.id, branchId);
    if (
      dto.assignmentStartsAt &&
      dto.assignmentEndsAt &&
      new Date(dto.assignmentStartsAt) > new Date(dto.assignmentEndsAt)
    ) {
      throw new BadRequestException('Assignment end date must be after its start date');
    }
    const seenDepartmentIds = new Set([department.id]);
    const additionalAssignments: Array<{
      input: NonNullable<CreateStaffDto['additionalAssignments']>[number];
      departmentId: string;
      branchId: string | null;
    }> = [];
    for (const input of dto.additionalAssignments ?? []) {
      if (seenDepartmentIds.has(input.departmentId)) {
        throw new BadRequestException('A department can only be assigned once per staff member');
      }
      seenDepartmentIds.add(input.departmentId);
      const assignedDepartment = await this.database.client.department.findFirst({
        where: {
          id: input.departmentId,
          tenantId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true, branchId: true },
      });
      if (!assignedDepartment) {
        throw new NotFoundException('Department assignment must belong to this organization');
      }
      const assignedBranchId = input.branchId ?? assignedDepartment.branchId ?? branchId ?? null;
      await this.validateBranch(tenantId, assignedBranchId);
      await this.assertDepartmentInScope(userId, tenantId, assignedDepartment.id, assignedBranchId);
      if (input.startsAt && input.endsAt && new Date(input.startsAt) > new Date(input.endsAt)) {
        throw new BadRequestException('Assignment end date must be after its start date');
      }
      additionalAssignments.push({
        input,
        departmentId: assignedDepartment.id,
        branchId: assignedBranchId,
      });
    }

    const serviceIds = [...new Set(dto.serviceIds ?? [])];
    if (serviceIds.length) {
      const services = await this.database.client.service.findMany({
        where: { id: { in: serviceIds }, tenantId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, departmentId: true, branchId: true },
      });
      if (services.length !== serviceIds.length) {
        throw new NotFoundException('One or more selected services are unavailable in this organization');
      }
      for (const service of services) {
        if (service.departmentId && service.departmentId !== department.id) {
          throw new BadRequestException('Selected services must belong to the primary department');
        }
        if (service.branchId && service.branchId !== branchId) {
          throw new BadRequestException('Selected services must belong to the selected branch');
        }
        await this.assertDepartmentInScope(
          userId,
          tenantId,
          service.departmentId ?? department.id,
          service.branchId ?? branchId,
        );
      }
    }
    if (dto.shiftEndTime <= dto.shiftStartTime) {
      throw new BadRequestException('Availability end time must be after its start time');
    }

    const identity = await this.database.client.identity.findUnique({
      where: {
        type_normalizedValue: {
          type: IdentityType.EMAIL,
          normalizedValue: normalizedEmail,
        },
      },
      select: { id: true },
    });
    if (identity) {
      throw new ConflictException('This email address is already registered');
    }

    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const staffNumber =
      dto.staffNumber?.trim() || `STF-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 10000)}`;
    const existingStaffNumber = await this.database.client.staffProfile.findFirst({
      where: { tenantId, staffNumber },
      select: { id: true },
    });
    if (existingStaffNumber) throw new ConflictException('Staff number is already in use');
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    let created: {
      profile: {
        id: string;
        staffNumber: string | null;
        firstName: string;
        lastName: string;
        email: string;
        status: string;
        createdAt: Date;
      };
      userId: string;
    };
    try {
      created = await this.database.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { displayName: `${firstName} ${lastName}` },
          select: { id: true },
        });
        await tx.identity.create({
          data: {
            userId: user.id,
            type: IdentityType.EMAIL,
            value: email,
            normalizedValue: normalizedEmail,
          },
        });
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            tenantId,
            branchId: branchId ?? null,
            departmentId: department.id,
            status: 'ACTIVE',
          },
        });
        const profile = await tx.staffProfile.create({
          data: {
            tenantId,
            userId: user.id,
            departmentId: department.id,
            branchId: branchId ?? null,
            staffNumber,
            firstName,
            middleName: dto.middleName?.trim() || null,
            lastName,
            email,
            phone: dto.phone?.trim() || null,
            whatsappNumber: dto.whatsappNumber?.trim() || null,
            gender: dto.gender ?? null,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
            nationalIdEncrypted: this.encryptNationalId(dto.nationalId),
            nationality: dto.nationality?.trim() || null,
            physicalAddress: dto.physicalAddress?.trim() || null,
            jobTitle: dto.jobTitle?.trim() || null,
            employmentType: dto.employmentType ?? 'FULL_TIME',
            professionalCategory: dto.professionalCategory ?? null,
            reportsToId: dto.reportsToId ?? null,
            licenseNumber: dto.licenseNumber?.trim() || null,
            specialty: dto.specialty?.trim() || null,
            subSpecialty: dto.subSpecialty?.trim() || null,
            licensingBody: dto.licensingBody?.trim() || null,
            licenseExpiresAt: dto.licenseExpiresAt ? new Date(dto.licenseExpiresAt) : null,
            qualifications: dto.qualifications?.trim() || null,
            yearsExperience: dto.yearsExperience ?? null,
            languages: dto.languages?.map((language) => language.trim()).filter(Boolean) ?? [],
            consultationFee: dto.consultationFee ?? null,
            telehealthEnabled: dto.telehealthEnabled ?? false,
            acceptsOnlineBookings: dto.acceptsOnlineBookings ?? false,
            acceptsNewPatients: dto.acceptsNewPatients ?? false,
            professionalBio: dto.professionalBio?.trim() || null,
            professionalLinks: dto.professionalLinks?.map((link) => link.trim()).filter(Boolean) ?? [],
            joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : null,
            status: StaffStatus.INVITED,
            invitationStatus: 'PENDING',
            invitationExpiresAt,
          },
          select: {
            id: true,
            staffNumber: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            createdAt: true,
          },
        });
        await tx.staffDepartmentAssignment.create({
          data: {
            staffProfileId: profile.id,
            departmentId: department.id,
            branchId: branchId ?? null,
            role: dto.role.trim(),
            isPrimaryDepartment: true,
            accessLevel: dto.accessLevel ?? 'OPERATE',
            canAccessDashboard: dto.canAccessDashboard ?? false,
            startsAt: dto.assignmentStartsAt ? new Date(dto.assignmentStartsAt) : null,
            endsAt: dto.assignmentEndsAt ? new Date(dto.assignmentEndsAt) : null,
            assignedById: userId,
          },
        });
        for (const { input, departmentId, branchId: assignedBranchId } of additionalAssignments) {
          await tx.staffDepartmentAssignment.create({
            data: {
              staffProfileId: profile.id,
              departmentId,
              branchId: assignedBranchId,
              role: input.role.trim(),
              accessLevel: input.accessLevel,
              isPrimaryDepartment: false,
              canAccessDashboard: input.canAccessDashboard ?? false,
              startsAt: input.startsAt ? new Date(input.startsAt) : null,
              endsAt: input.endsAt ? new Date(input.endsAt) : null,
              assignedById: userId,
            },
          });
          await tx.membership.create({
            data: {
              userId: user.id,
              tenantId,
              branchId: assignedBranchId,
              departmentId,
              status: 'ACTIVE',
            },
          });
        }
        if (serviceIds.length) {
          await tx.staffServiceAssignment.createMany({
            data: serviceIds.map((serviceId) => ({
              staffProfileId: profile.id,
              serviceId,
              assignedById: userId,
            })),
          });
        }
        if (dto.shiftName?.trim()) {
          if (!dto.shiftStartTime || !dto.shiftEndTime || !dto.shiftDays?.length) {
            throw new BadRequestException(
              'Shift name, start and end times, and at least one shift day are required',
            );
          }
          await tx.staffShift.create({
            data: {
              staffProfileId: profile.id,
              departmentId: department.id,
              branchId: branchId ?? null,
              shiftName: dto.shiftName.trim(),
              startTime: dto.shiftStartTime,
              endTime: dto.shiftEndTime,
              daysOfWeek: dto.shiftDays,
            },
          });
        }
        await tx.registration.create({
          data: {
            userId: user.id,
            tenantId,
            type: RegistrationType.TENANT,
            status: RegistrationStatus.VERIFICATION_REQUIRED,
            verificationStatus: VerificationStatus.PENDING,
            expiresAt: invitationExpiresAt,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorUserId: userId,
            branchId: branchId ?? null,
            action: 'staff.invited',
            resourceType: 'staff_profile',
            resourceId: profile.id,
            outcome: 'SUCCESS',
            metadata: {
              departmentId: department.id,
              role: dto.role.trim(),
              accessLevel: dto.accessLevel ?? 'OPERATE',
            },
          },
        });
        return { profile, userId: user.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This email address or staff record is already registered');
      }
      throw error;
    }

    try {
      await this.verificationService.createRegistrationVerification(created.userId, 'EMAIL');
      return {
        ...created.profile,
        invitationStatus: 'VERIFICATION_EMAIL_SENT',
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 503) {
        return {
          ...created.profile,
          invitationStatus: 'EMAIL_DELIVERY_FAILED',
        };
      }
      throw error;
    }
  }

  async resendInvitation(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: {
        id: staffProfileId,
        tenantId,
        status: { not: 'OFFBOARDED' },
        invitationStatus: { not: 'REVOKED' },
      },
      select: {
        id: true,
        userId: true,
        email: true,
        user: {
          select: {
            identities: {
              where: {
                type: IdentityType.EMAIL,
                status: 'ACTIVE',
              },
              select: { verifiedAt: true },
            },
          },
        },
      },
    });
    if (!profile) {
      throw new NotFoundException('Staff member not found');
    }

    if (!profile.user.identities[0]?.verifiedAt) {
      await this.database.client.staffProfile.update({
        where: { id: staffProfileId },
        data: {
          invitationStatus: 'PENDING',
          invitationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await this.verificationService.createRegistrationVerification(profile.userId, 'EMAIL');
      return { invitationStatus: 'VERIFICATION_EMAIL_SENT' };
    }

    return { invitationStatus: 'ADMIN_APPROVAL_REQUIRED' };
  }

  async revokeInvitation(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: StaffStatus.INVITED },
      select: { id: true, userId: true, branchId: true },
    });
    if (!profile) throw new NotFoundException('Pending staff invitation not found');

    return this.database.client.$transaction(async (tx) => {
      await tx.staffProfile.update({
        where: { id: staffProfileId },
        data: { status: StaffStatus.SUSPENDED, invitationStatus: 'REVOKED' },
      });
      await tx.staffDepartmentAssignment.updateMany({
        where: { staffProfileId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      await tx.membership.updateMany({
        where: { userId: profile.userId, tenantId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: profile.branchId,
          action: 'staff.invitation.revoked',
          resourceType: 'staff_profile',
          resourceId: staffProfileId,
          outcome: 'SUCCESS',
        },
      });
      return { id: staffProfileId, status: 'SUSPENDED', invitationStatus: 'REVOKED' };
    });
  }

  async approveStaff(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: {
        id: staffProfileId,
        tenantId,
        status: { in: [StaffStatus.ACTIVE, StaffStatus.INVITED] },
      },
      select: {
        id: true,
        userId: true,
        email: true,
        branchId: true,
        user: {
          select: {
            identities: {
              where: { type: IdentityType.EMAIL, status: 'ACTIVE' },
              select: { verifiedAt: true, credentialHash: true },
            },
          },
        },
      },
    });
    if (!profile) {
      throw new NotFoundException('Active staff member not found');
    }
    const emailIdentity = profile.user.identities[0];
    if (!emailIdentity?.verifiedAt) {
      throw new BadRequestException('Verify the staff email address before approving the account');
    }
    if (emailIdentity.credentialHash) {
      throw new ConflictException('This staff member already has a password configured');
    }
    const registration = await this.database.client.registration.findFirst({
      where: {
        userId: profile.userId,
        tenantId,
        type: RegistrationType.TENANT,
        status: {
          in: [RegistrationStatus.VERIFICATION_REQUIRED, RegistrationStatus.ONBOARDING],
        },
        verificationStatus: VerificationStatus.VERIFIED,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!registration) {
      throw new BadRequestException('Verified staff registration was not found');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.database.client.$transaction(async (tx) => {
      await tx.registrationSession.updateMany({
        where: { userId: profile.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.registrationSession.create({
        data: {
          userId: profile.userId,
          tokenHash,
          expiresAt,
          purpose: VerificationPurpose.REGISTRATION,
        },
      });
      await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: RegistrationStatus.ONBOARDING,
          onboardingStatus: 'IN_PROGRESS',
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: profile.branchId,
          action: 'staff.registration.approved',
          resourceType: 'staff_profile',
          resourceId: profile.id,
          outcome: 'SUCCESS',
          metadata: { registrationId: registration.id },
        },
      });
    });
    try {
      await this.verificationEmailService.sendStaffPasswordSetup(profile.email, token, expiresAt);
    } catch (error) {
      await this.database.client.registrationSession.updateMany({
        where: {
          userId: profile.userId,
          consumedAt: null,
          tokenHash,
        },
        data: { consumedAt: new Date() },
      });
      this.logger.error(
        'Approved staff password setup email could not be delivered',
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException('Password setup email could not be delivered', 503);
    }
    return { approvalStatus: 'APPROVED', passwordSetupEmailStatus: 'SENT' as const };
  }

  async getAccessHistory(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId },
      select: { id: true, userId: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    const [attempts, events] = await Promise.all([
      this.database.client.departmentAccessAttempt.findMany({
        where: { staffProfileId },
        select: {
          id: true,
          userId: true,
          departmentId: true,
          status: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          department: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.database.client.auditEvent.findMany({
        where: {
          tenantId,
          OR: [
            { actorUserId: staff.userId },
            { resourceType: 'staff_profile', resourceId: staffProfileId },
          ],
        },
        select: {
          id: true,
          actorUserId: true,
          branchId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          outcome: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return [
      ...attempts,
      ...events.map((event) => ({
        id: event.id,
        userId: event.actorUserId ?? staff.userId,
        departmentId: null,
        status: event.outcome,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        createdAt: event.createdAt,
        department: null,
        action: event.action,
        resource: `${event.resourceType}${event.resourceId ? `:${event.resourceId}` : ''}`,
        branchId: event.branchId,
      })),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 100);
  }

  async listDocuments(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    return this.database.client.staffDocument.findMany({
      where: { staffProfileId },
      select: {
        id: true,
        type: true,
        status: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        uploadedById: true,
        reviewedById: true,
        reviewNotes: true,
        expiresAt: true,
        createdAt: true,
        uploadedBy: { select: { displayName: true } },
        reviewedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async downloadProfilePhoto(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId },
      select: { profilePhotoKey: true, branchId: true },
    });
    if (!profile?.profilePhotoKey) throw new NotFoundException('Staff profile photo not found');
    const document = await this.database.client.staffDocument.findFirst({
      where: { staffProfileId, storageKey: profile.profilePhotoKey, type: 'PROFILE_PHOTO' },
      select: { id: true, contentType: true },
    });
    if (!document) throw new NotFoundException('Staff profile photo not found');
    let buffer: Buffer;
    try {
      buffer = await this.storage.get(profile.profilePhotoKey);
    } catch (error) {
      if (isMissingStoredObject(error)) {
        throw new NotFoundException('Staff profile photo is no longer available');
      }
      this.logger.error(
        `Unable to read stored profile photo for staff profile ${staffProfileId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Staff profile photo is temporarily unavailable');
    }
    await this.database.client.auditEvent.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId: profile.branchId,
        action: 'staff.photo.viewed',
        resourceType: 'staff_document',
        resourceId: document.id,
        outcome: 'SUCCESS',
      },
    });
    return { buffer, contentType: document.contentType };
  }

  async removeProfilePhoto(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId },
      select: { id: true, branchId: true },
    });
    if (!profile) throw new NotFoundException('Staff member not found');
    const photos = await this.database.client.staffDocument.findMany({
      where: { staffProfileId, type: 'PROFILE_PHOTO' },
      select: { id: true, storageKey: true },
    });
    await this.database.client.$transaction(async (tx) => {
      await tx.staffProfile.update({
        where: { id: staffProfileId },
        data: { profilePhotoKey: null, profilePhotoUrl: null },
      });
      await tx.staffDocument.deleteMany({ where: { staffProfileId, type: 'PROFILE_PHOTO' } });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: profile.branchId,
          action: 'staff.photo.removed',
          resourceType: 'staff_profile',
          resourceId: staffProfileId,
          outcome: 'SUCCESS',
        },
      });
    });
    await Promise.all(photos.map(({ storageKey }) => this.storage.delete(storageKey).catch((error) => {
      this.logger.error('A removed staff photo could not be deleted from private storage', error);
    })));
    return { profilePhotoRemoved: true };
  }

  async uploadDocument(
    userId: string,
    staffProfileId: string,
    dto: UploadStaffDocumentDto,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: { not: StaffStatus.OFFBOARDED } },
      select: { id: true, branchId: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const isPhoto = dto.type === 'PROFILE_PHOTO';
    const maxSize = isPhoto ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.buffer.length === 0 || file.buffer.length > maxSize || file.size !== file.buffer.length) {
      throw new BadRequestException(
        isPhoto ? 'Profile photos must be 5 MB or smaller' : 'Documents must be 10 MB or smaller',
      );
    }
    const extensions: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    if (!extensions[file.mimetype] || (isPhoto && file.mimetype === 'application/pdf')) {
      throw new BadRequestException('Only PDF, JPG, PNG, and WEBP files are accepted');
    }
    if (!this.matchesFileSignature(file.mimetype, file.buffer)) {
      throw new BadRequestException('File content does not match its declared type');
    }

    const fileName = basename(file.originalname.replaceAll('\\', '/'))
      .replace(/[\r\n";]/g, '_')
      .slice(0, 255);
    const storageKey = `tenant/${tenantId}/staff/${staffProfileId}/${randomUUID()}.${extensions[file.mimetype]}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    try {
      return await this.database.client.$transaction(async (tx) => {
        const document = await tx.staffDocument.create({
          data: {
            staffProfileId,
            type: dto.type,
            fileName: fileName || `staff-document.${extensions[file.mimetype]}`,
            storageKey,
            contentType: file.mimetype,
            sizeBytes: file.buffer.length,
            uploadedById: userId,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          },
          select: {
            id: true,
            type: true,
            status: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            createdAt: true,
          },
        });
        if (isPhoto) {
          await tx.staffProfile.update({
            where: { id: staffProfileId },
            data: { profilePhotoKey: storageKey, profilePhotoUrl: null },
          });
        }
        await tx.staffProfile.update({
          where: { id: staffProfileId },
          data: { verificationStatus: 'DOCUMENTS_PENDING' },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            actorUserId: userId,
            branchId: staff.branchId,
            action: 'staff.document.uploaded',
            resourceType: 'staff_document',
            resourceId: document.id,
            outcome: 'SUCCESS',
            metadata: { staffProfileId, type: dto.type, sizeBytes: file.buffer.length },
          },
        });
        return document;
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async downloadDocument(userId: string, staffProfileId: string, documentId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const document = await this.database.client.staffDocument.findFirst({
      where: { id: documentId, staffProfileId, staffProfile: { tenantId } },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        storageKey: true,
        staffProfile: { select: { branchId: true } },
      },
    });
    if (!document) throw new NotFoundException('Staff document not found');
    const buffer = await this.storage.get(document.storageKey);
    await this.database.client.auditEvent.create({
      data: {
        tenantId,
        actorUserId: userId,
        branchId: document.staffProfile.branchId,
        action: 'staff.document.downloaded',
        resourceType: 'staff_document',
        resourceId: document.id,
        outcome: 'SUCCESS',
      },
    });
    return { buffer, fileName: document.fileName, contentType: document.contentType };
  }

  async reviewDocument(
    userId: string,
    staffProfileId: string,
    documentId: string,
    dto: ReviewStaffDocumentDto,
  ) {
    if (dto.status === 'REJECTED' && !dto.reviewNotes?.trim()) {
      throw new BadRequestException('A review reason is required when rejecting a document');
    }
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const document = await this.database.client.staffDocument.findFirst({
      where: { id: documentId, staffProfileId, staffProfile: { tenantId } },
      select: {
        id: true,
        type: true,
        staffProfile: { select: { id: true, userId: true, branchId: true } },
      },
    });
    if (!document) throw new NotFoundException('Staff document not found');

    return this.database.client.$transaction(async (tx) => {
      const reviewed = await tx.staffDocument.update({
        where: { id: documentId },
        data: {
          status: dto.status,
          reviewedById: userId,
          reviewNotes: dto.reviewNotes?.trim() || null,
        },
        select: {
          id: true,
          type: true,
          status: true,
          fileName: true,
          reviewNotes: true,
          reviewedById: true,
          updatedAt: true,
        },
      });
      const documents = await tx.staffDocument.findMany({
        where: { staffProfileId },
        select: { type: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      const currentDocuments = new Map<string, (typeof documents)[number]>();
      for (const entry of documents) {
        if (!currentDocuments.has(entry.type)) currentDocuments.set(entry.type, entry);
      }
      const currentDocumentList = [...currentDocuments.values()];
      const identity = await tx.identity.findFirst({
        where: {
          userId: document.staffProfile.userId,
          type: IdentityType.EMAIL,
          status: 'ACTIVE',
        },
        select: { verifiedAt: true },
      });
      const profile = await tx.staffProfile.findUniqueOrThrow({
        where: { id: staffProfileId },
        select: { professionalCategory: true },
      });
      const regulated = profile.professionalCategory &&
        !['ADMIN', 'RECEPTIONIST', 'OTHER'].includes(profile.professionalCategory);
      const licenseVerified = currentDocumentList.some(
        (entry) => entry.type === 'PROFESSIONAL_LICENSE' && entry.status === 'VERIFIED',
      );
      const verificationStatus = !identity?.verifiedAt
        ? 'EMAIL_PENDING'
        : currentDocumentList.some((entry) => entry.status === 'REJECTED')
          ? 'REJECTED'
          : currentDocumentList.some((entry) => entry.status === 'UNDER_REVIEW')
            ? 'DOCUMENTS_UNDER_REVIEW'
            : currentDocumentList.some((entry) => entry.status === 'UPLOADED') ||
                (regulated && !licenseVerified)
              ? 'DOCUMENTS_PENDING'
              : 'VERIFIED';
      await tx.staffProfile.update({
        where: { id: staffProfileId },
        data: { verificationStatus },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: document.staffProfile.branchId,
          action: `staff.document.${dto.status.toLowerCase()}`,
          resourceType: 'staff_document',
          resourceId: document.id,
          outcome: 'SUCCESS',
          metadata: { staffProfileId, type: document.type, reviewNotes: dto.reviewNotes?.trim() },
        },
      });
      return reviewed;
    });
  }

  async deleteDocument(userId: string, staffProfileId: string, documentId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const document = await this.database.client.staffDocument.findFirst({
      where: { id: documentId, staffProfileId, staffProfile: { tenantId } },
      select: {
        id: true,
        type: true,
        storageKey: true,
        status: true,
        staffProfile: { select: { branchId: true, profilePhotoKey: true } },
      },
    });
    if (!document) throw new NotFoundException('Staff document not found');
    await this.database.client.$transaction(async (tx) => {
      await tx.staffDocument.delete({ where: { id: documentId } });
      if (document.staffProfile.profilePhotoKey === document.storageKey) {
        await tx.staffProfile.update({
          where: { id: staffProfileId },
          data: { profilePhotoKey: null, profilePhotoUrl: null },
        });
      }
      if (document.type === 'PROFESSIONAL_LICENSE' || document.status === 'VERIFIED') {
        await tx.staffProfile.update({
          where: { id: staffProfileId },
          data: { verificationStatus: 'DOCUMENTS_PENDING' },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: document.staffProfile.branchId,
          action: 'staff.document.deleted',
          resourceType: 'staff_document',
          resourceId: document.id,
          outcome: 'SUCCESS',
          metadata: { staffProfileId, type: document.type },
        },
      });
    });
    await this.storage.delete(document.storageKey).catch((error) => {
      this.logger.error('A removed staff document could not be deleted from private storage', error);
    });
    return { id: documentId, deleted: true };
  }

  async revokeDepartment(userId: string, staffProfileId: string, assignmentId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const assignment = await this.database.client.staffDepartmentAssignment.findFirst({
      where: { id: assignmentId, staffProfileId, staffProfile: { tenantId } },
      select: {
        id: true,
        departmentId: true,
        branchId: true,
        isPrimaryDepartment: true,
        staffProfile: { select: { id: true, userId: true, branchId: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Department assignment not found');

    const nextPrimary = assignment.isPrimaryDepartment
      ? await this.database.client.staffDepartmentAssignment.findFirst({
          where: { staffProfileId, status: 'ACTIVE', id: { not: assignmentId } },
          select: { id: true, departmentId: true, branchId: true },
          orderBy: { assignedAt: 'asc' },
        })
      : null;
    if (assignment.isPrimaryDepartment && !nextPrimary) {
      throw new BadRequestException('Assign another department as primary before removing this one');
    }

    return this.database.client.$transaction(async (tx) => {
      await tx.staffDepartmentAssignment.update({
        where: { id: assignmentId },
        data: { status: 'REVOKED', isPrimaryDepartment: false },
      });
      const duplicateAccess = await tx.staffDepartmentAssignment.findFirst({
        where: {
          staffProfileId,
          departmentId: assignment.departmentId,
          branchId: assignment.branchId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!duplicateAccess) {
        await tx.membership.updateMany({
          where: {
            userId: assignment.staffProfile.userId,
            tenantId,
            departmentId: assignment.departmentId,
            branchId: assignment.branchId,
            status: 'ACTIVE',
          },
          data: { status: 'REVOKED' },
        });
      }
      if (nextPrimary) {
        await tx.staffDepartmentAssignment.update({
          where: { id: nextPrimary.id },
          data: { isPrimaryDepartment: true },
        });
        await tx.staffProfile.update({
          where: { id: staffProfileId },
          data: { departmentId: nextPrimary.departmentId, branchId: nextPrimary.branchId },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: assignment.branchId ?? assignment.staffProfile.branchId,
          action: 'staff.department.revoked',
          resourceType: 'staff_department_assignment',
          resourceId: assignmentId,
          outcome: 'SUCCESS',
          metadata: {
            staffProfileId,
            departmentId: assignment.departmentId,
            promoted: nextPrimary?.id,
          },
        },
      });
      return { id: assignmentId, status: 'REVOKED', promotedAssignmentId: nextPrimary?.id ?? null };
    });
  }

  async listTimeOff(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    return this.database.client.staffTimeOff.findMany({
      where: { staffProfileId },
      orderBy: { startsAt: 'desc' },
    });
  }

  async createTimeOff(userId: string, staffProfileId: string, dto: CreateStaffTimeOffDto) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: StaffStatus.ACTIVE },
      select: { id: true, branchId: true },
    });
    if (!staff) throw new NotFoundException('Active staff member not found');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (startsAt >= endsAt) throw new BadRequestException('Time-off end must be after its start');
    if (endsAt.getTime() - startsAt.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Time-off requests cannot exceed one year');
    }
    const scheduledDays = new Set<string>();
    const dayCodes = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    for (
      const day = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate()));
      day <= endsAt;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      scheduledDays.add(dayCodes[day.getUTCDay()] ?? 'MON');
    }
    const activeShifts = await this.database.client.staffShift.findMany({
      where: { staffProfileId, status: 'ACTIVE' },
      select: { shiftName: true, daysOfWeek: true },
    });
    const scheduleConflicts = activeShifts
      .filter((shift) =>
        Array.isArray(shift.daysOfWeek) &&
        shift.daysOfWeek.some((day) => typeof day === 'string' && scheduledDays.has(day)),
      )
      .map((shift) => shift.shiftName);

    return this.database.client.$transaction(async (tx) => {
      const request = await tx.staffTimeOff.create({
        data: {
          staffProfileId,
          startsAt,
          endsAt,
          reason: dto.reason?.trim() || null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: staff.branchId,
          action: 'staff.time_off.requested',
          resourceType: 'staff_time_off',
          resourceId: request.id,
          outcome: 'SUCCESS',
          metadata: { staffProfileId, startsAt, endsAt, scheduleConflicts },
        },
      });
      return { ...request, scheduleConflicts };
    });
  }

  async reviewTimeOff(
    userId: string,
    staffProfileId: string,
    timeOffId: string,
    dto: ReviewStaffTimeOffDto,
  ) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const request = await this.database.client.staffTimeOff.findFirst({
      where: { id: timeOffId, staffProfileId, staffProfile: { tenantId } },
      select: { id: true, staffProfile: { select: { branchId: true } } },
    });
    if (!request) throw new NotFoundException('Time-off request not found');
    return this.database.client.$transaction(async (tx) => {
      const updated = await tx.staffTimeOff.update({
        where: { id: timeOffId },
        data: {
          status: dto.status,
          reviewedById: userId,
          reviewNotes: dto.reviewNotes?.trim() || null,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: request.staffProfile.branchId,
          action: `staff.time_off.${dto.status.toLowerCase()}`,
          resourceType: 'staff_time_off',
          resourceId: request.id,
          outcome: 'SUCCESS',
          metadata: { staffProfileId },
        },
      });
      return updated;
    });
  }

  private matchesFileSignature(mimeType: string, buffer: Buffer): boolean {
    if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
    if (mimeType === 'image/jpeg') {
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === 'image/png') {
      return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    if (mimeType === 'image/webp') {
      return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    }
    return false;
  }

  private encryptNationalId(value?: string): string | null {
    const normalized = value?.trim();
    if (!normalized) return null;
    const configuredKey = process.env.STAFF_PII_ENCRYPTION_KEY;
    if (!configuredKey) {
      throw new ServiceUnavailableException(
        'STAFF_PII_ENCRYPTION_KEY must be configured before storing national identifiers',
      );
    }
    const key = Buffer.from(configuredKey, 'base64');
    if (key.length !== 32) {
      throw new ServiceUnavailableException('STAFF_PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  async assignDepartment(userId: string, staffProfileId: string, dto: AssignStaffDepartmentDto) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: StaffStatus.ACTIVE },
      select: { id: true, userId: true, branchId: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    if (staff.userId === userId) {
      throw new ForbiddenException('Staff members cannot change their own department access');
    }
    const department = await this.database.client.department.findFirst({
      where: {
        id: dto.departmentId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, branchId: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found in this organization');
    }
    const branchId = dto.branchId ?? department.branchId ?? staff.branchId;
    await this.validateBranch(tenantId, branchId);
    await this.assertDepartmentInScope(userId, tenantId, department.id, branchId);
    const isPrimaryDepartment = dto.isPrimaryDepartment ?? false;
    if (dto.startsAt && dto.endsAt && new Date(dto.startsAt) > new Date(dto.endsAt)) {
      throw new BadRequestException('Assignment end date must be after its start date');
    }
    const activeDepartmentAssignment = await this.database.client.staffDepartmentAssignment.findFirst({
      where: { staffProfileId, departmentId: department.id, status: 'ACTIVE' },
      select: { id: true, role: true, isPrimaryDepartment: true },
    });
    if (activeDepartmentAssignment && activeDepartmentAssignment.role !== dto.role.trim()) {
      throw new ConflictException('This department is already assigned to the staff member');
    }
    const currentPrimary = await this.database.client.staffDepartmentAssignment.findFirst({
      where: { staffProfileId, status: 'ACTIVE', isPrimaryDepartment: true },
      select: { id: true },
    });
    if (!currentPrimary && !isPrimaryDepartment) {
      throw new BadRequestException('The first active department assignment must be primary');
    }
    if (activeDepartmentAssignment?.isPrimaryDepartment && !isPrimaryDepartment) {
      throw new BadRequestException('Assign another department as primary before changing this assignment');
    }

    return this.database.client.$transaction(async (tx) => {
      if (isPrimaryDepartment) {
        await tx.staffDepartmentAssignment.updateMany({
          where: { staffProfileId, status: 'ACTIVE' },
          data: { isPrimaryDepartment: false },
        });
      }
      const assignment = await tx.staffDepartmentAssignment.upsert({
        where: {
          staffProfileId_departmentId_role: {
            staffProfileId,
            departmentId: department.id,
            role: dto.role.trim(),
          },
        },
        create: {
          staffProfileId,
          departmentId: department.id,
          branchId,
          role: dto.role.trim(),
          accessLevel: dto.accessLevel,
          isPrimaryDepartment,
          canAccessDashboard: dto.canAccessDashboard ?? false,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          assignedById: userId,
          status: 'ACTIVE',
        },
        update: {
          branchId,
          accessLevel: dto.accessLevel,
          isPrimaryDepartment,
          canAccessDashboard: dto.canAccessDashboard ?? false,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          assignedById: userId,
          assignedAt: new Date(),
          status: 'ACTIVE',
        },
        select: {
          id: true,
          departmentId: true,
          branchId: true,
          role: true,
          accessLevel: true,
          isPrimaryDepartment: true,
          canAccessDashboard: true,
          startsAt: true,
          endsAt: true,
          status: true,
        },
      });
      const membership = await tx.membership.findFirst({
        where: {
          userId: staff.userId,
          tenantId,
          departmentId: department.id,
          branchId,
        },
        select: { id: true },
      });
      if (membership) {
        await tx.membership.update({
          where: { id: membership.id },
          data: { status: 'ACTIVE' },
        });
      } else {
        await tx.membership.create({
          data: {
            userId: staff.userId,
            tenantId,
            branchId,
            departmentId: department.id,
            status: 'ACTIVE',
          },
        });
      }
      if (isPrimaryDepartment) {
        await tx.staffProfile.update({
          where: { id: staffProfileId },
          data: { departmentId: department.id, branchId },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId,
          action: 'staff.department.assigned',
          resourceType: 'staff_department_assignment',
          resourceId: assignment.id,
          outcome: 'SUCCESS',
          metadata: {
            staffProfileId,
            departmentId: department.id,
            role: dto.role.trim(),
            accessLevel: dto.accessLevel,
            isPrimaryDepartment,
          },
        },
      });
      return assignment;
    });
  }

  async createShift(userId: string, staffProfileId: string, dto: CreateStaffShiftDto) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: {
        id: staffProfileId,
        tenantId,
        status: StaffStatus.ACTIVE,
        assignments: {
          some: { departmentId: dto.departmentId, status: 'ACTIVE' },
        },
      },
      select: { id: true, branchId: true },
    });
    if (!staff) {
      throw new ForbiddenException('Staff member must have an active department assignment');
    }
    const department = await this.database.client.department.findFirst({
      where: {
        id: dto.departmentId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, branchId: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found in this organization');
    }
    const branchId = dto.branchId ?? department.branchId ?? staff.branchId;
    await this.validateBranch(tenantId, branchId);
    await this.assertDepartmentInScope(userId, tenantId, department.id, branchId);
    if (dto.breakStartTime && dto.breakEndTime) {
      if (
        dto.breakStartTime < dto.startTime ||
        dto.breakEndTime > dto.endTime ||
        dto.breakStartTime >= dto.breakEndTime
      ) {
        throw new BadRequestException('Break times must fall within the shift');
      }
    } else if (dto.breakStartTime || dto.breakEndTime) {
      throw new BadRequestException('Provide both break start and end times');
    }
    const activeShifts = await this.database.client.staffShift.findMany({
      where: { staffProfileId, status: 'ACTIVE' },
      select: { startTime: true, endTime: true, daysOfWeek: true },
    });
    const newDays = new Set(dto.daysOfWeek);
    const hasConflict = activeShifts.some((existing) => {
      const existingDays = Array.isArray(existing.daysOfWeek)
        ? existing.daysOfWeek.filter((day): day is string => typeof day === 'string')
        : [];
      const overlapsDay = existingDays.some((day) => newDays.has(day));
      const overlapsTime = dto.startTime < existing.endTime && dto.endTime > existing.startTime;
      return overlapsDay && overlapsTime;
    });
    if (hasConflict) {
      throw new BadRequestException('This shift overlaps another assigned department shift');
    }
    const shift = await this.database.client.$transaction(async (tx) => {
      const created = await tx.staffShift.create({
        data: {
          staffProfileId,
          departmentId: department.id,
          branchId,
          shiftName: dto.shiftName.trim(),
          startTime: dto.startTime,
          endTime: dto.endTime,
          breakStartTime: dto.breakStartTime ?? null,
          breakEndTime: dto.breakEndTime ?? null,
          daysOfWeek: dto.daysOfWeek,
          status: dto.status ?? 'ACTIVE',
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId,
          action: 'staff.shift.assigned',
          resourceType: 'staff_shift',
          resourceId: created.id,
          outcome: 'SUCCESS',
          metadata: { staffProfileId, departmentId: department.id },
        },
      });
      return created;
    });
    return shift;
  }

  async updateStatus(userId: string, staffProfileId: string, status: StaffStatus) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const staff = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId },
      select: { id: true, userId: true, branchId: true, status: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    if (staff.status === StaffStatus.OFFBOARDED && status !== StaffStatus.OFFBOARDED) {
      throw new ForbiddenException('Offboarded staff members cannot be reactivated');
    }
    if (staff.status === StaffStatus.INVITED && status === StaffStatus.ACTIVE) {
      throw new ForbiddenException('Invited staff can only be activated after secure password setup');
    }
    if (status === StaffStatus.INVITED) {
      throw new BadRequestException('Staff status cannot be changed back to invited');
    }
    return this.database.client.$transaction(async (tx) => {
      const suspended = status === StaffStatus.SUSPENDED;
      const offboarded = status === StaffStatus.OFFBOARDED;
      const updated = await tx.staffProfile.update({
        where: { id: staffProfileId },
        data: { status },
        select: { id: true, status: true, updatedAt: true },
      });
      if (suspended || offboarded) {
        await tx.staffDepartmentAssignment.updateMany({
          where: { staffProfileId, status: 'ACTIVE' },
          data: { status: offboarded ? 'REVOKED' : 'SUSPENDED' },
        });
        await tx.staffShift.updateMany({
          where: { staffProfileId, status: 'ACTIVE' },
          data: { status: offboarded ? 'INACTIVE' : 'SUSPENDED' },
        });
        await tx.membership.updateMany({
          where: { userId: staff.userId, tenantId, status: 'ACTIVE' },
          data: { status: offboarded ? 'REVOKED' : 'SUSPENDED' },
        });
      } else if (status === StaffStatus.ACTIVE && staff.status !== StaffStatus.ACTIVE) {
        await tx.staffDepartmentAssignment.updateMany({
          where: { staffProfileId, status: 'SUSPENDED' },
          data: { status: 'ACTIVE' },
        });
        await tx.staffShift.updateMany({
          where: { staffProfileId, status: 'SUSPENDED' },
          data: { status: 'ACTIVE' },
        });
        await tx.membership.updateMany({
          where: { userId: staff.userId, tenantId, status: 'SUSPENDED' },
          data: { status: 'ACTIVE' },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: staff.branchId,
          action: `staff.status.${status.toLowerCase()}`,
          resourceType: 'staff_profile',
          resourceId: staffProfileId,
          outcome: 'SUCCESS',
          metadata: { previousStatus: staff.status, status },
        },
      });
      return updated;
    });
  }

  async sendPasswordReset(userId: string, staffProfileId: string) {
    const tenantId = await this.getTenantIdForUser(userId, staffProfileId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, status: StaffStatus.ACTIVE },
      select: {
        id: true,
        userId: true,
        email: true,
        branchId: true,
        user: {
          select: {
            identities: {
              where: { type: IdentityType.EMAIL, status: 'ACTIVE' },
              select: { verifiedAt: true, normalizedValue: true },
            },
          },
        },
      },
    });
    if (!profile) {
      throw new NotFoundException('Active staff member not found');
    }
    if (!profile.user.identities[0]?.verifiedAt) {
      throw new BadRequestException('Verify the staff email address before resetting its password');
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.database.client.$transaction(async (tx) => {
      await tx.registrationSession.updateMany({
        where: { userId: profile.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.registrationSession.create({
        data: {
          userId: profile.userId,
          tokenHash,
          expiresAt,
          purpose: VerificationPurpose.PASSWORD_RESET,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          branchId: profile.branchId,
          action: 'staff.password_reset.requested',
          resourceType: 'staff_profile',
          resourceId: profile.id,
          outcome: 'SUCCESS',
        },
      });
    });
    try {
      await this.verificationEmailService.sendStaffPasswordReset(profile.email, token, expiresAt);
    } catch (error) {
      await this.database.client.registrationSession.updateMany({
        where: { userId: profile.userId, tokenHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      this.logger.error(
        'Staff password reset email could not be delivered',
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException('Password reset email could not be delivered', 503);
    }
    return { resetEmailStatus: 'SENT' as const };
  }

  private async validateBranch(
    tenantId: string,
    branchId: string | null | undefined,
  ): Promise<void> {
    if (!branchId) {
      return;
    }
    const branch = await this.database.client.branch.findFirst({
      where: { id: branchId, tenantId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found in this organization');
    }
  }

  private async getTenantIdForUser(userId: string, staffProfileId?: string): Promise<string> {
    const now = new Date();
    const memberships = await this.database.client.membership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        tenant: { status: 'ACTIVE', deletedAt: null },
      },
      select: { tenantId: true },
      distinct: ['tenantId'],
      take: 2,
    });
    const membership = memberships[0];
    if (!membership) {
      throw new NotFoundException('Active organization membership not found');
    }
    if (memberships.length > 1) {
      throw new ForbiddenException('Select an organization context before managing staff');
    }
    const tenantId = membership.tenantId;
    if (staffProfileId) await this.assertStaffInScope(userId, tenantId, staffProfileId);
    return tenantId;
  }

  private async getStaffScopeWhere(
    userId: string,
    tenantId: string,
  ): Promise<Prisma.StaffProfileWhereInput> {
    const now = new Date();
    const membership = await this.database.client.membership.findFirst({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { branchId: true, departmentId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenException('Active organization membership is required');
    if (!membership.branchId && !membership.departmentId) return {};
    if (membership.departmentId) {
      return {
        OR: [
          { departmentId: membership.departmentId },
          { assignments: { some: { departmentId: membership.departmentId, status: 'ACTIVE' } } },
        ],
      };
    }
    return {
      OR: [
        { branchId: membership.branchId },
        { assignments: { some: { branchId: membership.branchId, status: 'ACTIVE' } } },
      ],
    };
  }

  private async assertStaffInScope(userId: string, tenantId: string, staffProfileId: string): Promise<void> {
    const scopeWhere = await this.getStaffScopeWhere(userId, tenantId);
    const profile = await this.database.client.staffProfile.findFirst({
      where: { id: staffProfileId, tenantId, ...scopeWhere },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Staff member not found in your branch or department');
  }

  private async assertDepartmentInScope(
    userId: string,
    tenantId: string,
    departmentId: string,
    branchId: string | null,
  ): Promise<void> {
    const now = new Date();
    const membership = await this.database.client.membership.findFirst({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { branchId: true, departmentId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new ForbiddenException('Active organization membership is required');
    if (membership.departmentId && membership.departmentId !== departmentId) {
      throw new ForbiddenException('You cannot assign staff outside your department');
    }
    if (membership.branchId && membership.branchId !== branchId) {
      throw new ForbiddenException('You cannot assign staff outside your branch');
    }
  }
}
