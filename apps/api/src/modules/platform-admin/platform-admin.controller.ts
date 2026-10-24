import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import { DatabaseService } from '../../database/database.service.js';
import { PlatformPermissionGuard } from '../authorization/guards/platform-permission.guard.js';
import { RequirePlatformPermission } from '../authorization/decorators/require-platform-permission.decorator.js';

@Controller('v1/platform-admin')
@UseGuards(AccessTokenGuard)
export class PlatformAdminController {
  constructor(private readonly database: DatabaseService) {}

  @Get('management-access')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('management_portal', 'access')
  getManagementAccess() {
    return { allowed: true };
  }

  @Get('tenants')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('management_portal', 'read')
  async listTenants() {
    const tenants = await this.database.client.tenant.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            memberships: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      code: tenant.code,
      type: tenant.type,
      status: tenant.status,
      membershipCount: tenant._count.memberships,
      createdAt: tenant.createdAt,
    }));
  }

  @Get('stats')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('management_portal', 'read')
  async getStats() {
    const [tenantCount, activeTenantCount, userCount] = await Promise.all([
      this.database.client.tenant.count({
        where: { deletedAt: null },
      }),
      this.database.client.tenant.count({
        where: { status: 'ACTIVE', deletedAt: null },
      }),
      this.database.client.user.count(),
    ]);

    return {
      tenantCount,
      activeTenantCount,
      userCount,
    };
  }

  @Get('users')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('management_portal', 'read')
  async listPlatformUsers(@Query() query: { page?: string; limit?: string; status?: string }) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };

    if (query.status) {
      where.status = query.status;
    }

    const [users, total] = await Promise.all([
      this.database.client.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          platformRoleAssignments: {
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  scope: true,
                },
              },
            },
          },
          _count: {
            select: { memberships: true, sessions: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.database.client.user.count({ where }),
    ]);

    return {
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        platformRoles: user.platformRoleAssignments.map((a) => a.role),
        membershipCount: user._count.memberships,
        sessionCount: user._count.sessions,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  @Get('audit-events')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('management_portal', 'read')
  async listAuditEvents(@Query() query: { page?: string; limit?: string; actorId?: string; action?: string; resourceType?: string; startDate?: string; endDate?: string }) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.actorId) where.actorUserId = query.actorId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.startDate || query.endDate) {
      where.createdAt = {} as Record<string, unknown>;
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const [events, total] = await Promise.all([
      this.database.client.auditEvent.findMany({
        where,
        select: {
          id: true, action: true, resourceType: true, resourceId: true,
          outcome: true, reason: true, correlationId: true, ipAddress: true,
          userAgent: true, createdAt: true,
          actorUser: { select: { id: true, displayName: true, username: true } },
        },
        skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      this.database.client.auditEvent.count({ where }),
    ]);

    return {
      events,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  @Get('security-events')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('management_portal', 'read')
  async listSecurityEvents(@Query() query: { page?: string; limit?: string; actorId?: string; eventType?: string; severity?: string; startDate?: string; endDate?: string }) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.actorId) where.actorUserId = query.actorId;
    if (query.eventType) where.eventType = { contains: query.eventType, mode: 'insensitive' };
    if (query.severity) where.severity = query.severity;
    if (query.startDate || query.endDate) {
      where.createdAt = {} as Record<string, unknown>;
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    const [events, total] = await Promise.all([
      this.database.client.securityEvent.findMany({
        where,
        select: {
          id: true, eventType: true, severity: true, outcome: true,
          ipAddress: true, userAgent: true, createdAt: true,
          actorUser: { select: { id: true, displayName: true, username: true } },
        },
        skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      this.database.client.securityEvent.count({ where }),
    ]);

    return {
      events,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
