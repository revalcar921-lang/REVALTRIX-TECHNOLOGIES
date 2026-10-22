import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  NotificationChannel,
  NotificationDeliveryStatus,
} from '@prisma/client';

import { DatabaseService } from '../../database/database.service.js';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  getWebPushPublicKey() {
    const publicKey =
      this.config.get<string>('notifications.webPush.publicKey');
    const privateKey =
      this.config.get<string>('notifications.webPush.privateKey');

    return {
      data: {
        publicKey: publicKey && privateKey ? publicKey : '',
      },
    };
  }

  async saveWebPushSubscription(
    userId: string,
    subscription: {
      endpoint: string;
      p256dh: string;
      auth: string;
    },
  ) {
    if (
      !this.config.get<string>('notifications.webPush.publicKey') ||
      !this.config.get<string>('notifications.webPush.privateKey')
    ) {
      throw new BadRequestException('Web push is not configured on this server.');
    }

    const existing =
      await this.database.client.webPushSubscription.findUnique({
        where: {
          endpoint: subscription.endpoint,
        },
        select: {
          userId: true,
        },
      });

    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'This browser push subscription is already linked to another account.',
      );
    }

    const saved =
      await this.database.client.webPushSubscription.upsert({
        where: {
          endpoint: subscription.endpoint,
        },
        create: {
          userId,
          ...subscription,
        },
        update: {
          userId,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        select: {
          id: true,
        },
      });

    return {
      data: saved,
    };
  }

  async deleteWebPushSubscription(userId: string, endpoint: string) {
    const result =
      await this.database.client.webPushSubscription.deleteMany({
        where: {
          userId,
          endpoint,
        },
      });

    return {
      data: {
        deleted: result.count,
      },
    };
  }

  async listMyNotifications(
    userId: string,
    query: {
      unreadOnly?: boolean;
      limit?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);

    const notifications =
      await this.database.client.notification.findMany({
        where: {
          recipientUserId: userId,
          ...(query.unreadOnly
            ? {
                readAt: null,
              }
            : {}),
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
          deliveries: {
            select: {
              id: true,
              channel: true,
              status: true,
              sentAt: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

    return {
      data: notifications,
    };
  }

  async getMyNotification(
    userId: string,
    notificationId: string,
  ) {
    const notification =
      await this.database.client.notification.findFirst({
        where: {
          id: notificationId,
          recipientUserId: userId,
        },
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
          updatedAt: true,
          deliveries: {
            select: {
              id: true,
              channel: true,
              status: true,
              attempts: true,
              availableAt: true,
              sentAt: true,
              failedAt: true,
              failureReason: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    return {
      data: notification,
    };
  }

  async deleteMyNotification(userId: string, notificationId: string) {
    const result = await this.database.client.notification.deleteMany({
      where: {
        id: notificationId,
        recipientUserId: userId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Notification not found.');
    }

    return {
      data: {
        deleted: true,
      },
    };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ) {
    const result =
      await this.database.client.notification.updateMany({
        where: {
          id: notificationId,
          recipientUserId: userId,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });

    if (result.count === 0) {
      const existing =
        await this.database.client.notification.findFirst({
          where: {
            id: notificationId,
            recipientUserId: userId,
          },
          select: {
            id: true,
          },
        });

      if (!existing) {
        throw new NotFoundException('Notification not found.');
      }
    }

    return this.getMyNotification(userId, notificationId);
  }

  async markAllAsRead(userId: string) {
    const result =
      await this.database.client.notification.updateMany({
        where: {
          recipientUserId: userId,
          readAt: null,
        },
        data: {
          readAt: new Date(),
        },
      });

    return {
      data: {
        updated: result.count,
      },
    };
  }

  async createNotification(params: {
    tenantId?: string | null;
    recipientUserId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    channels?: NotificationChannel[];
    idempotencyPrefix?: string;
  }) {
    return this.database.client.$transaction((tx) => this.createNotificationInTransaction(tx, params));
  }

  async createNotificationInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      tenantId?: string | null;
      recipientUserId: string;
      type: string;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      channels?: NotificationChannel[];
      idempotencyPrefix?: string;
    },
  ) {
    const channels =
      params.channels?.length
        ? [...new Set(params.channels)]
        : [NotificationChannel.IN_APP];
    if (params.idempotencyPrefix) {
      const existing = await tx.notification.findFirst({
        where: {
          idempotencyKey: `${params.idempotencyPrefix}:${params.recipientUserId}:${params.type}`,
        },
        select: { id: true },
      });
      if (existing) return existing;
    }
    const notification = await tx.notification.create({
      data: {
        tenantId: params.tenantId ?? null,
        recipientUserId: params.recipientUserId,
          ...(params.idempotencyPrefix ? { idempotencyKey: `${params.idempotencyPrefix}:${params.recipientUserId}:${params.type}` } : {}),
        type: params.type,
        title: params.title,
        body: params.body,
        ...(params.data !== undefined
          ? { data: { ...params.data, ...(params.idempotencyPrefix ? { eventKey: params.idempotencyPrefix } : {}) } as Prisma.InputJsonValue }
          : params.idempotencyPrefix ? { data: { eventKey: params.idempotencyPrefix } } : {}),
      },
    });
    await tx.notificationDelivery.createMany({
      data: channels.map((channel) => ({
        notificationId: notification.id,
        channel,
        status: NotificationDeliveryStatus.PENDING,
        idempotencyKey: `${params.idempotencyPrefix ?? notification.id}:${notification.id}:${channel}`,
      })),
    });
    return notification;
  }
}
