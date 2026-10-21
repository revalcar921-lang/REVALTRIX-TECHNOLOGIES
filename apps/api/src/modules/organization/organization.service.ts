import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

@Injectable()
export class OrganizationService {
  constructor(private readonly database: DatabaseService) {}

  private async getMembership(userId: string) {
    const membership = await this.database.client.membership.findFirst({
      where: {
        userId,
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
        tenant: {
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'Active organization membership was not found',
      );
    }

    return membership;
  }

  async getOrganization(userId: string) {
    const membership = await this.getMembership(userId);

    const tenant = await this.database.client.tenant.findUnique({
      where: {
        id: membership.tenantId,
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        code: true,
        type: true,
        status: true,
        profile: {
          select: {
            businessName: true,
            legalName: true,
            registrationNumber: true,
            taxIdentificationNumber: true,
            registrationCountry: true,
            businessType: true,
            incorporationDate: true,
            country: true,
            county: true,
            subcounty: true,
            city: true,
            address: true,
            latitude: true,
            longitude: true,
            postalCode: true,
            website: true,
            contactEmail: true,
            contactPhone: true,
            supportEmail: true,
            whatsappNumber: true,
            description: true,
            ownershipType: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Organization was not found');
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        legalName: tenant.legalName,
        code: tenant.code,
        type: tenant.type,
        status: tenant.status,
      },
      profile: tenant.profile,
    };
  }

  async updateOrganization(
    userId: string,
    input: UpdateOrganizationDto,
  ) {
    const membership = await this.getMembership(userId);

    const tenant = await this.database.client.tenant.findUnique({
      where: {
        id: membership.tenantId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Organization was not found');
    }

    if (tenant.status !== 'ACTIVE') {
      throw new ConflictException(
        'Organization is not active and cannot be updated',
      );
    }

    const tenantData = {
      ...(input.businessName !== undefined
        ? { name: input.businessName.trim() }
        : {}),
      ...(input.legalName !== undefined
        ? { legalName: input.legalName.trim() }
        : {}),
    };

    const profileData = {
      ...(input.businessName !== undefined
        ? { businessName: input.businessName.trim() }
        : {}),
      ...(input.legalName !== undefined
        ? { legalName: input.legalName.trim() }
        : {}),
      ...(input.registrationNumber !== undefined
        ? { registrationNumber: input.registrationNumber.trim() }
        : {}),
      ...(input.taxIdentificationNumber !== undefined
        ? {
            taxIdentificationNumber:
              input.taxIdentificationNumber.trim(),
          }
        : {}),
      ...(input.registrationCountry !== undefined
        ? { registrationCountry: input.registrationCountry.trim() || null }
        : {}),
      ...(input.businessType !== undefined
        ? { businessType: input.businessType.trim() || null }
        : {}),
      ...(input.incorporationDate !== undefined
        ? { incorporationDate: input.incorporationDate ? new Date(input.incorporationDate) : null }
        : {}),
      ...(input.country !== undefined
        ? { country: input.country.trim() }
        : {}),
      ...(input.county !== undefined
        ? { county: input.county.trim() || null }
        : {}),
      ...(input.subcounty !== undefined
        ? { subcounty: input.subcounty.trim() || null }
        : {}),
      ...(input.city !== undefined
        ? { city: input.city.trim() || null }
        : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.address !== undefined
        ? { address: input.address.trim() || null }
        : {}),
      ...(input.postalCode !== undefined
        ? { postalCode: input.postalCode.trim() || null }
        : {}),
      ...(input.website !== undefined
        ? { website: input.website.trim() || null }
        : {}),
      ...(input.contactEmail !== undefined
        ? { contactEmail: input.contactEmail.trim().toLowerCase() || null }
        : {}),
      ...(input.contactPhone !== undefined
        ? { contactPhone: input.contactPhone.trim() || null }
        : {}),
      ...(input.supportEmail !== undefined
        ? { supportEmail: input.supportEmail.trim().toLowerCase() || null }
        : {}),
      ...(input.whatsappNumber !== undefined
        ? { whatsappNumber: input.whatsappNumber.trim() || null }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() || null }
        : {}),
      ...(input.ownershipType !== undefined
        ? { ownershipType: input.ownershipType.trim() || null }
        : {}),
    };

    if (Object.keys(tenantData).length === 0 &&
        Object.keys(profileData).length === 0) {
      return this.getOrganization(userId);
    }

    await this.database.client.$transaction(async (tx) => {
      if (Object.keys(tenantData).length > 0) {
        await tx.tenant.update({
          where: {
            id: membership.tenantId,
          },
          data: tenantData,
        });
      }

      await tx.tenantProfile.upsert({
        where: {
          tenantId: membership.tenantId,
        },
        create: {
          tenantId: membership.tenantId,
          country:
            input.country?.trim() ||
            'Kenya',
          ...profileData,
        },
        update: profileData,
      });
    });

    return this.getOrganization(userId);
  }
}
