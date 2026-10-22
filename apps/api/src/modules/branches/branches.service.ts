import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import type { CreateBranchDto } from './dto/create-branch.dto.js';
import type { UpdateBranchDto } from './dto/update-branch.dto.js';

@Injectable()
export class BranchesService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string) {
    const tenantId = await this.getTenantIdForUser(userId);

    return this.database.client.branch.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        town: true,
        county: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        contactPhone: true,
        contactEmail: true,
        openingTime: true,
        closingTime: true,
        operatingDays: true,
        status: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            departments: true,
            memberships: true,
            services: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        {
          name: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  async getById(userId: string, branchId: string) {
    const tenantId = await this.getTenantIdForUser(userId);

    const branch = await this.database.client.branch.findFirst({
      where: {
        id: branchId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        town: true,
        county: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        contactPhone: true,
        contactEmail: true,
        openingTime: true,
        closingTime: true,
        operatingDays: true,
        status: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        departments: {
          where: {
            status: 'ACTIVE',
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
          },
          orderBy: {
            name: 'asc',
          },
        },
        _count: {
          select: {
            departments: true,
            memberships: true,
            services: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async create(userId: string, dto: CreateBranchDto) {
    const tenantId = await this.getTenantIdForUser(userId);

    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException('Enter both branch coordinates or leave both blank.');
    }

    const name = dto.name.trim();
    const code = dto.code.trim().toUpperCase();

    await this.ensureUniqueCode(tenantId, code);
    await this.validateOrganization(
      tenantId,
      dto.organizationId,
    );

    return this.database.client.branch.create({
      data: {
        tenantId,
        name,
        code,
        address: dto.address?.trim() || null,
        town: dto.town?.trim() || null,
        county: dto.county?.trim() || null,
        postalCode: dto.postalCode?.trim() || null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        contactPhone: dto.contactPhone?.trim() || null,
        contactEmail: dto.contactEmail?.trim().toLowerCase() || null,
        openingTime: dto.openingTime ?? null,
        closingTime: dto.closingTime ?? null,
        operatingDays: dto.operatingDays ?? [],
        organizationId: dto.organizationId ?? null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        town: true,
        county: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        contactPhone: true,
        contactEmail: true,
        openingTime: true,
        closingTime: true,
        operatingDays: true,
        status: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(
    userId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ) {
    const tenantId = await this.getTenantIdForUser(userId);

    const existing = await this.database.client.branch.findFirst({
      where: {
        id: branchId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        latitude: true,
        longitude: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Branch not found');
    }

    const data: {
      name?: string;
      code?: string;
      address?: string | null;
      town?: string | null;
      county?: string | null;
      postalCode?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      contactPhone?: string | null;
      contactEmail?: string | null;
      openingTime?: string | null;
      closingTime?: string | null;
      operatingDays?: string[];
      organizationId?: string | null;
    } = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();

      if (code !== existing.code) {
        await this.ensureUniqueCode(tenantId, code);
      }

      data.code = code;
    }

    if (dto.address !== undefined) {
      data.address = dto.address?.trim() || null;
    }
    if (dto.town !== undefined) {
      data.town = dto.town?.trim() || null;
    }
    if (dto.county !== undefined) {
      data.county = dto.county?.trim() || null;
    }
    if (dto.postalCode !== undefined) {
      data.postalCode = dto.postalCode?.trim() || null;
    }
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;

    const nextLatitude = dto.latitude === undefined ? existing.latitude : dto.latitude;
    const nextLongitude = dto.longitude === undefined ? existing.longitude : dto.longitude;
    if ((nextLatitude === null) !== (nextLongitude === null)) {
      throw new BadRequestException('Enter both branch coordinates or clear both.');
    }
    if (dto.contactPhone !== undefined) {
      data.contactPhone = dto.contactPhone?.trim() || null;
    }
    if (dto.contactEmail !== undefined) {
      data.contactEmail = dto.contactEmail?.trim().toLowerCase() || null;
    }
    if (dto.openingTime !== undefined) {
      data.openingTime = dto.openingTime || null;
    }
    if (dto.closingTime !== undefined) {
      data.closingTime = dto.closingTime || null;
    }
    if (dto.operatingDays !== undefined) {
      data.operatingDays = dto.operatingDays;
    }

    if (dto.organizationId !== undefined) {
      await this.validateOrganization(
        tenantId,
        dto.organizationId,
      );

      data.organizationId = dto.organizationId;
    }

    if (Object.keys(data).length === 0) {
      return this.getById(userId, branchId);
    }

    return this.database.client.branch.update({
      where: {
        id: branchId,
      },
      data,
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        town: true,
        county: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        contactPhone: true,
        contactEmail: true,
        openingTime: true,
        closingTime: true,
        operatingDays: true,
        status: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(userId: string, branchId: string) {
    const tenantId = await this.getTenantIdForUser(userId);

    const branch = await this.database.client.branch.findFirst({
      where: {
        id: branchId,
        tenantId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return this.database.client.branch.update({
      where: {
        id: branch.id,
      },
      data: {
        status: 'INACTIVE',
        deletedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        deletedAt: true,
      },
    });
  }

  private async getTenantIdForUser(
    userId: string,
  ): Promise<string> {
    const now = new Date();

    const membership =
      await this.database.client.membership.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          startsAt: {
            lte: now,
          },
          OR: [
            {
              endsAt: null,
            },
            {
              endsAt: {
                gt: now,
              },
            },
          ],
          tenant: {
            status: 'ACTIVE',
            deletedAt: null,
          },
        },
        select: {
          tenantId: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'Active tenant membership not found',
      );
    }

    return membership.tenantId;
  }

  private async ensureUniqueCode(
    tenantId: string,
    code: string,
  ): Promise<void> {
    const existing =
      await this.database.client.branch.findFirst({
        where: {
          tenantId,
          code,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

    if (existing) {
      throw new ConflictException(
        'A branch with this code already exists',
      );
    }
  }

  private async validateOrganization(
    tenantId: string,
    organizationId?: string | null,
  ): Promise<void> {
    if (organizationId === undefined || organizationId === null) {
      return;
    }

    const organization =
      await this.database.client.organization.findFirst({
        where: {
          id: organizationId,
          tenantId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

    if (!organization) {
      throw new NotFoundException(
        'Organization not found in the current tenant',
      );
    }
  }
}
