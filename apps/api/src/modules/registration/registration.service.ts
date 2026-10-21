import { ConflictException, Injectable } from '@nestjs/common';
import {
  DepartmentCategory,
  DepartmentType,
  IdentityType,
  RegistrationStatus,
  RegistrationType,
  VerificationStatus,
  OnboardingStatus,
  Prisma,
  RecordStatus,
  TenantType,
} from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { RegisterTenantDto } from './dto/register-tenant.dto.js';
import { RegisterPatientDto } from './dto/register-patient.dto.js';
import { provisionTenantWebsite } from '../tenant-websites/tenant-website.utils.js';

@Injectable()
export class RegistrationService {
  constructor(private readonly database: DatabaseService) {}

  async registerTenant(dto: RegisterTenantDto) {
    const email = dto.adminEmail.trim().toLowerCase();
    const phone = this.normalizePhone(dto.adminPhone);

    const existingEmail = await this.database.client.identity.findUnique({
      where: {
        type_normalizedValue: {
          type: IdentityType.EMAIL,
          normalizedValue: email,
        },
      },
      select: { id: true },
    });

    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    const existingPhone = await this.database.client.identity.findUnique({
      where: {
        type_normalizedValue: {
          type: IdentityType.PHONE,
          normalizedValue: phone,
        },
      },
      select: { id: true },
    });

    if (existingPhone) {
      throw new ConflictException('Phone is already registered');
    }

    const result = await this.database.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName: dto.adminName.trim(),
        },
      });

      await tx.identity.create({
        data: {
          userId: user.id,
          type: IdentityType.EMAIL,
          value: dto.adminEmail.trim(),
          normalizedValue: email,
        },
      });

      await tx.identity.create({
        data: {
          userId: user.id,
          type: IdentityType.PHONE,
          value: dto.adminPhone.trim(),
          normalizedValue: phone,
        },
      });

      const tenant = await tx.tenant.create({
        data: {
          type: dto.tenantType,
          name: dto.businessName.trim(),
          code: await this.generateTenantCode(tx, dto.businessName),
          profile: {
            create: {
              businessName: dto.businessName.trim(),
              country: 'Kenya',
              contactEmail: email,
              contactPhone: dto.adminPhone.trim(),
            },
          },
        },
      });

      await provisionTenantWebsite(tx, tenant.id, tenant.name, tenant.code, user.id);

      await this.seedDefaultDepartments(tx, tenant.id, dto.tenantType);

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
        },
      });

      const adminRole = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: 'Tenant Administrator',
          code: 'TENANT_ADMIN',
          scope: 'TENANT',
          description: 'Administrator for the tenant',
        },
      });

      const permissions = await tx.permission.findMany({
        where: {
          tenantId: null,
          scope: 'TENANT',
          effect: 'ALLOW',
          status: 'ACTIVE',
        },
        select: {
          id: true,
        },
      });

      if (permissions.length === 0) {
        throw new ConflictException('Authorization permission catalog is not configured');
      }

      await tx.membershipRole.create({
        data: {
          membershipId: membership.id,
          roleId: adminRole.id,
        },
      });

      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: adminRole.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });

      const registration = await tx.registration.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          type: RegistrationType.TENANT,
          status: RegistrationStatus.VERIFICATION_REQUIRED,
          verificationStatus: VerificationStatus.PENDING,
          onboardingStatus: OnboardingStatus.NOT_STARTED,
        },
      });

      return {
        user,
        tenant,
        registration,
      };
    });

    const registrationToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(registrationToken).digest('hex');

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.database.client.registrationSession.create({
      data: {
        userId: result.user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      registrationId: result.registration.id,
      tenantId: result.tenant.id,
      userId: result.user.id,
      status: result.registration.status,
      verificationStatus: result.registration.verificationStatus,
      onboardingStatus: result.registration.onboardingStatus,
      registrationToken,
      registrationTokenExpiresAt: expiresAt,
    };
  }

  private async seedDefaultDepartments(
    tx: Prisma.TransactionClient,
    tenantId: string,
    tenantType: TenantType,
  ) {
    const departmentTemplates: {
      name: string;
      code: string;
      type: DepartmentType;
      category: DepartmentCategory;
      shortName: string;
      description: string;
    }[] = [
      {
        name: 'Reception',
        code: 'RECEPTION',
        type: DepartmentType.OPD,
        category: DepartmentCategory.ADMINISTRATIVE,
        shortName: 'REC',
        description: 'Front desk and patient intake hub.',
      },
      {
        name: 'Administration',
        code: 'ADMIN',
        type: DepartmentType.CUSTOM,
        category: DepartmentCategory.ADMINISTRATIVE,
        shortName: 'ADM',
        description: 'Administrative coordination and operations.',
      },
      {
        name: 'Outpatient Department',
        code: 'OPD',
        type: DepartmentType.OPD,
        category: DepartmentCategory.CLINICAL,
        shortName: 'OPD',
        description: 'Primary consultations and outpatient clinical services.',
      },
      {
        name: 'Nursing Unit',
        code: 'NURSING',
        type: DepartmentType.INPATIENT_WARD,
        category: DepartmentCategory.CLINICAL,
        shortName: 'NUR',
        description: 'Ward-based patient care and continuity of service.',
      },
      {
        name: 'Pharmacy',
        code: 'PHARMACY',
        type: DepartmentType.PHARMACY,
        category: DepartmentCategory.CLINICAL_SUPPORT,
        shortName: 'PHARM',
        description: 'Medication management and dispensing support.',
      },
      {
        name: 'Laboratory',
        code: 'LAB',
        type: DepartmentType.LABORATORY,
        category: DepartmentCategory.DIAGNOSTICS,
        shortName: 'LAB',
        description: 'Diagnostics and test processing.',
      },
      {
        name: 'Radiology',
        code: 'RAD',
        type: DepartmentType.RADIOLOGY,
        category: DepartmentCategory.DIAGNOSTICS,
        shortName: 'RAD',
        description: 'Imaging and interpretation services.',
      },
      {
        name: 'Billing & Finance',
        code: 'BILLING',
        type: DepartmentType.BILLING_FINANCE,
        category: DepartmentCategory.ADMINISTRATIVE,
        shortName: 'FIN',
        description: 'Financial operations and revenue management.',
      },
      {
        name: 'Housekeeping',
        code: 'HOUSEKEEPING',
        type: DepartmentType.HOUSEKEEPING_INFECTION_CONTROL,
        category: DepartmentCategory.SUPPORT,
        shortName: 'HK',
        description: 'Environmental hygiene and safety support controls.',
      },
    ];

    const filteredTemplates = departmentTemplates.filter((template) => {
      if (
        tenantType === 'PHARMACY' ||
        tenantType === 'LABORATORY' ||
        tenantType === 'RADIOLOGY_CENTER'
      ) {
        return template.code !== 'NURSING' && template.code !== 'RECEPTION';
      }

      return true;
    });

    const data: Prisma.DepartmentCreateManyInput[] = filteredTemplates.map((template) => ({
      tenantId,
      name: template.name,
      code: template.code,
      slug: template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type: template.type,
      category: template.category,
      shortName: template.shortName,
      description: template.description,
      status: RecordStatus.ACTIVE,
      requiresDepartmentPassword: false,
      autoGeneratedFeatures: {
        type: template.type,
        category: template.category,
        enabledPages: ['Overview', 'Queue', 'Staff', 'Reports'],
        modules: ['dashboard', 'staff', 'queue', 'reports'],
        generatedBy: 'revaltrix-default-tenant-bootstrap',
      },
      dashboardConfig: {
        layout: 'command-center',
        widgets: ['overview', 'queue', 'staff', 'alerts'],
        refreshIntervalSeconds: 20,
      },
      sidebarConfig: {
        groups: [{ label: 'Core', items: ['Overview', 'Queue', 'Staff', 'Reports'] }],
      },
      workflowConfig: {
        stages: ['Intake', 'Process', 'Review', 'Close'],
      },
      settings: {
        departmentType: template.type,
        category: template.category,
        requiresDepartmentPassword: false,
      },
    }));

    if (data.length === 0) {
      return;
    }

    await tx.department.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async registerPatient(dto: RegisterPatientDto) {
    const email = dto.email.trim().toLowerCase();
    const phone = this.normalizePhone(dto.phone);

    const existingEmail = await this.database.client.identity.findUnique({
      where: {
        type_normalizedValue: {
          type: IdentityType.EMAIL,
          normalizedValue: email,
        },
      },
      select: { id: true },
    });

    if (existingEmail) {
      throw new ConflictException('Email is already registered');
    }

    const existingPhone = await this.database.client.identity.findUnique({
      where: {
        type_normalizedValue: {
          type: IdentityType.PHONE,
          normalizedValue: phone,
        },
      },
      select: { id: true },
    });

    if (existingPhone) {
      throw new ConflictException('Phone is already registered');
    }

    const result = await this.database.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName: `${dto.firstName.trim()} ${dto.secondName.trim()}`,
        },
      });

      await tx.identity.create({
        data: {
          userId: user.id,
          type: IdentityType.EMAIL,
          value: dto.email.trim(),
          normalizedValue: email,
        },
      });

      await tx.identity.create({
        data: {
          userId: user.id,
          type: IdentityType.PHONE,
          value: dto.phone.trim(),
          normalizedValue: phone,
        },
      });

      await tx.patientProfile.create({
        data: {
          userId: user.id,
          firstName: dto.firstName.trim(),
          secondName: dto.secondName.trim(),
          location: dto.location.trim(),
        },
      });

      const registration = await tx.registration.create({
        data: {
          userId: user.id,
          type: RegistrationType.PATIENT,
          status: RegistrationStatus.VERIFICATION_REQUIRED,
          verificationStatus: VerificationStatus.PENDING,
          onboardingStatus: OnboardingStatus.NOT_STARTED,
        },
      });

      return {
        user,
        registration,
      };
    });

    const registrationToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(registrationToken).digest('hex');

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.database.client.registrationSession.create({
      data: {
        userId: result.user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      registrationId: result.registration.id,
      userId: result.user.id,
      status: result.registration.status,
      verificationStatus: result.registration.verificationStatus,
      onboardingStatus: result.registration.onboardingStatus,
      registrationToken,
      registrationTokenExpiresAt: expiresAt,
    };
  }

  private normalizePhone(phone: string): string {
    return phone.trim().replace(/[^\d+]/g, '');
  }

  private async generateTenantCode(
    tx: Parameters<Parameters<typeof this.database.client.$transaction>[0]>[0],
    businessName: string,
  ): Promise<string> {
    const base =
      businessName
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 12) || 'TENANT';

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      const code = `${base}-${suffix}`;

      const existing = await tx.tenant.findUnique({
        where: { code },
        select: { id: true },
      });

      if (!existing) {
        return code;
      }
    }

    throw new ConflictException('Unable to generate a unique tenant code');
  }
}
