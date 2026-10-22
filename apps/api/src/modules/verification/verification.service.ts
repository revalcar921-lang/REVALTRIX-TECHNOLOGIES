import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { VerificationEmailService } from '../communication/email/verification-email.service.js';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly verificationEmailService: VerificationEmailService,
  ) {}

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizePhone(phone: string): string {
    return phone.trim().replace(/[^\d+]/g, '');
  }

  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private async sendPhoneVerification(target: string, code: string): Promise<void> {
    const apiKey = process.env.AFRICASTALKING_API_KEY?.trim();
    const username = process.env.AFRICASTALKING_USERNAME?.trim();
    if (!apiKey || !username) {
      throw new ServiceUnavailableException('Phone verification is unavailable until SMS delivery is configured.');
    }

    const recipient = target.startsWith('+')
      ? target
      : target.startsWith('0')
        ? `+254${target.slice(1)}`
        : target.startsWith('254')
          ? `+${target}`
          : target;
    const message = new URLSearchParams({
      username,
      to: recipient,
      message: `Your Revaltrix verification code is ${code}. It expires in 10 minutes.`,
    });
    const senderId = process.env.AFRICASTALKING_SENDER_ID?.trim();
    if (senderId) message.set('from', senderId);

    let response: Response;
    try {
      response = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: message,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('Phone verification SMS could not be delivered. Please try again later.');
    }

    const result = await response.json().catch(() => null) as {
      SMSMessageData?: { Recipients?: Array<{ status?: string; statusCode?: number }> };
    } | null;
    const recipients = result?.SMSMessageData?.Recipients;
    if (!response.ok || !recipients?.length || recipients.some((entry) =>
      entry.statusCode !== 101 && entry.status?.toLowerCase() !== 'success',
    )) {
      throw new ServiceUnavailableException('Phone verification SMS could not be delivered. Please try again later.');
    }
  }

  async createRegistrationVerification(userId: string, channel: 'EMAIL' | 'PHONE') {
    const identity = await this.database.client.identity.findFirst({
      where: {
        userId,
        type: channel === 'EMAIL' ? 'EMAIL' : 'PHONE',
        status: 'ACTIVE',
      },
      select: {
        value: true,
        normalizedValue: true,
        verifiedAt: true,
      },
    });

    if (!identity) {
      throw new BadRequestException(
        `No active ${channel.toLowerCase()} identity exists for this account`,
      );
    }

    if (identity.verifiedAt) {
      throw new BadRequestException(
        `${channel === 'EMAIL' ? 'Email' : 'Phone'} is already verified`,
      );
    }

    const target =
      channel === 'EMAIL'
        ? this.normalizeEmail(identity.normalizedValue)
        : this.normalizePhone(identity.normalizedValue);

    const activeChallenge = await this.database.client.verificationChallenge.findFirst({
      where: {
        userId,
        channel,
        purpose: 'REGISTRATION',
        verifiedAt: null,
        consumedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (activeChallenge) {
      throw new HttpException(
        'A verification code is already active. Please use the existing code or wait for it to expire.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const challenge = await this.database.client.verificationChallenge.create({
      data: {
        userId,
        channel,
        purpose: 'REGISTRATION',
        target,
        codeHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
      },
      select: {
        id: true,
        channel: true,
        target: true,
        expiresAt: true,
      },
    });

    if (channel === 'EMAIL') {
      const staffProfile = await this.database.client.staffProfile.findFirst({
        where: {
          userId,
          status: { in: ['ACTIVE', 'INVITED'] },
        },
        select: { id: true },
      });

      if (staffProfile) {
        const registrationToken = randomBytes(32).toString('base64url');
        const registrationTokenHash = createHash('sha256').update(registrationToken).digest('hex');
        const registrationTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
        const registrationSession = await this.database.client.registrationSession.create({
          data: {
            userId,
            tokenHash: registrationTokenHash,
            expiresAt: registrationTokenExpiresAt,
          },
          select: { id: true },
        });

        try {
          await this.verificationEmailService.sendStaffVerification(
            target,
            code,
            registrationToken,
            expiresAt,
          );
        } catch {
          await this.database.client.$transaction([
            this.database.client.verificationChallenge.update({
              where: { id: challenge.id },
              data: { consumedAt: new Date() },
            }),
            this.database.client.registrationSession.update({
              where: { id: registrationSession.id },
              data: { consumedAt: new Date() },
            }),
          ]);
          throw new ServiceUnavailableException(
            'Verification email could not be delivered. Please try again later.',
          );
        }

        return {
          challengeId: challenge.id,
          channel: challenge.channel,
          target: challenge.target,
          expiresAt: challenge.expiresAt,
          deliveryStatus: 'SENT',
        };
      }

      try {
        await this.verificationEmailService.sendRegistrationVerification(target, code, expiresAt);
      } catch (error) {
        await this.database.client.verificationChallenge.update({
          where: { id: challenge.id },
          data: {
            consumedAt: new Date(),
          },
        });

        throw new ServiceUnavailableException(
          'Verification email could not be delivered. Please try again later.',
        );
      }
    } else {
      try {
        await this.sendPhoneVerification(target, code);
      } catch (error) {
        await this.database.client.verificationChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
        throw error;
      }
    }

    return {
      challengeId: challenge.id,
      channel: challenge.channel,
      target: challenge.target,
      expiresAt: challenge.expiresAt,
      deliveryStatus: 'SENT',
    };
  }

  async sendStaffPatientRegistrationVerification(patientRecordId: string, tenantId: string) {
    const patientRecord = await this.database.client.patientTenantRecord.findFirst({
      where: {
        id: patientRecordId,
        tenantId,
        status: 'PENDING',
        deletedAt: null,
      },
      select: {
        patientProfile: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!patientRecord) {
      throw new BadRequestException('Pending patient record was not found for your organization');
    }

    const registration = await this.database.client.registration.findFirst({
      where: {
        userId: patientRecord.patientProfile.userId,
        tenantId,
        type: 'PATIENT',
        status: 'VERIFICATION_REQUIRED',
        verificationStatus: 'PENDING',
      },
      select: {
        id: true,
      },
    });

    if (!registration) {
      throw new BadRequestException(
        'This patient is waiting for relationship approval, not identity verification',
      );
    }

    const now = new Date();

    await this.database.client.$transaction([
      this.database.client.verificationChallenge.updateMany({
        where: {
          userId: patientRecord.patientProfile.userId,
          channel: 'EMAIL',
          purpose: 'REGISTRATION',
          verifiedAt: null,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          consumedAt: now,
        },
      }),
      this.database.client.registration.update({
        where: { id: registration.id },
        data: {
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return this.createRegistrationVerification(patientRecord.patientProfile.userId, 'EMAIL');
  }

  async verifyPatientRegistrationCode(
    challengeId: string,
    code: string,
    staffActorUserId?: string,
    staffTenantId?: string,
  ) {
    const challenge = await this.database.client.verificationChallenge.findFirst({
      where: {
        id: challengeId,
        purpose: 'REGISTRATION',
      },
    });

    if (!challenge) {
      throw new BadRequestException('Verification challenge not found');
    }

    if (challenge.verifiedAt || challenge.consumedAt) {
      throw new BadRequestException('Verification challenge has already been used');
    }

    if (challenge.expiresAt <= new Date()) {
      throw new BadRequestException('Verification code has expired');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new HttpException(
        'Maximum verification attempts exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const normalizedCode = code.trim();

    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new BadRequestException('Verification code must contain 6 digits');
    }

    const codeHash = this.hashCode(normalizedCode);

    if (codeHash !== challenge.codeHash) {
      await this.database.client.verificationChallenge.update({
        where: {
          id: challenge.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      throw new BadRequestException('Invalid verification code');
    }

    const now = new Date();

    const result = await this.database.client.$transaction(async (tx) => {
      const identity = await tx.identity.findFirst({
        where: {
          userId: challenge.userId,
          type: challenge.channel === 'EMAIL' ? 'EMAIL' : 'PHONE',
          normalizedValue: challenge.target,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          verifiedAt: true,
        },
      });

      if (!identity) {
        throw new BadRequestException('Verification identity no longer exists');
      }

      await tx.verificationChallenge.update({
        where: {
          id: challenge.id,
        },
        data: {
          verifiedAt: now,
          consumedAt: now,
        },
      });

      if (!identity.verifiedAt) {
        await tx.identity.update({
          where: {
            id: identity.id,
          },
          data: {
            verifiedAt: now,
          },
        });
      }

      const registration = await tx.registration.findFirst({
        where: {
          userId: challenge.userId,
          tenantId: {
            not: null,
          },
          type: 'PATIENT',
          status: 'VERIFICATION_REQUIRED',
          verificationStatus: 'PENDING',
        },
        select: {
          id: true,
          tenantId: true,
          expiresAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!registration || !registration.tenantId) {
        throw new BadRequestException('No pending hospital patient registration was found');
      }

      if (staffTenantId && registration.tenantId !== staffTenantId) {
        throw new BadRequestException('Patient registration does not belong to your organization');
      }

      if (registration.expiresAt && registration.expiresAt <= now) {
        throw new BadRequestException('Patient registration has expired');
      }

      const patientProfile = await tx.patientProfile.findUnique({
        where: {
          userId: challenge.userId,
        },
        select: {
          id: true,
        },
      });

      if (!patientProfile) {
        throw new BadRequestException('Patient profile not found');
      }

      const patientRecord = await tx.patientTenantRecord.findFirst({
        where: {
          patientProfileId: patientProfile.id,
          tenantId: registration.tenantId,
          status: 'PENDING',
          deletedAt: null,
        },
        select: {
          id: true,
          patientNumber: true,
        },
      });

      if (!patientRecord) {
        throw new BadRequestException('Pending hospital patient record not found');
      }

      await tx.registration.update({
        where: {
          id: registration.id,
        },
        data: {
          verificationStatus: 'VERIFIED',
          status: 'ONBOARDING',
          onboardingStatus: 'IN_PROGRESS',
        },
      });

      await tx.patientTenantRecord.update({
        where: {
          id: patientRecord.id,
        },
        data: {
          status: 'ACTIVE',
        },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: registration.tenantId,
          actorUserId: staffActorUserId ?? challenge.userId,
          action: 'PATIENT_REGISTRATION_VERIFIED',
          resourceType: 'PATIENT_TENANT_RECORD',
          resourceId: patientRecord.id,
          outcome: 'SUCCESS',
          reason: 'Patient verified identity for hospital registration',
          metadata: {
            registrationId: registration.id,
            patientProfileId: patientProfile.id,
            patientNumber: patientRecord.patientNumber,
            verificationChannel: challenge.channel,
            challengeId: challenge.id,
          },
        },
      });

      return {
        registrationId: registration.id,
        patientRecordId: patientRecord.id,
        patientNumber: patientRecord.patientNumber,
        tenantId: registration.tenantId,
      };
    });

    // The verification transaction has committed successfully.
    // Invalidate older sessions and issue a fresh, short-lived onboarding
    // session for the verified patient.
    await this.database.client.registrationSession.updateMany({
      where: {
        userId: challenge.userId,
        consumedAt: null,
      },
      data: {
        consumedAt: now,
      },
    });

    const registrationToken = randomBytes(32).toString('base64url');
    const registrationTokenHash = createHash('sha256').update(registrationToken).digest('hex');

    const registrationTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.database.client.registrationSession.create({
      data: {
        userId: challenge.userId,
        tokenHash: registrationTokenHash,
        expiresAt: registrationTokenExpiresAt,
      },
    });

    let onboardingEmailSent = false;

    const verifiedEmail = await this.database.client.identity.findFirst({
      where: {
        userId: challenge.userId,
        type: 'EMAIL',
        status: 'ACTIVE',
        verifiedAt: {
          not: null,
        },
      },
      select: {
        value: true,
      },
    });

    if (verifiedEmail) {
      try {
        await this.verificationEmailService.sendPatientOnboarding(
          verifiedEmail.value,
          registrationToken,
          registrationTokenExpiresAt,
        );

        onboardingEmailSent = true;
      } catch {
        // Verification has already committed. Email delivery failure must
        // not undo the patient's verified state or the fresh session.
      }
    }

    return {
      verified: true,
      channel: challenge.channel,
      challengeId: challenge.id,
      verificationStatus: 'VERIFIED',
      registrationStatus: 'ONBOARDING',
      onboardingEmailSent,
      registrationTokenExpiresAt,
      patientRecord: {
        id: result.patientRecordId,
        patientNumber: result.patientNumber,
        status: 'ACTIVE',
      },
    };
  }

  async verifyRegistrationCode(userId: string, challengeId: string, code: string) {
    const challenge = await this.database.client.verificationChallenge.findFirst({
      where: {
        id: challengeId,
        userId,
        purpose: 'REGISTRATION',
      },
    });

    if (!challenge) {
      throw new BadRequestException('Verification challenge not found');
    }

    if (challenge.verifiedAt || challenge.consumedAt) {
      throw new BadRequestException('Verification challenge has already been used');
    }

    if (challenge.expiresAt <= new Date()) {
      throw new BadRequestException('Verification code has expired');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new HttpException(
        'Maximum verification attempts exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const normalizedCode = code.trim();

    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new BadRequestException('Verification code must contain 6 digits');
    }

    const codeHash = this.hashCode(normalizedCode);

    if (codeHash !== challenge.codeHash) {
      await this.database.client.verificationChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      throw new BadRequestException('Invalid verification code');
    }

    const now = new Date();
    const staffProfile = await this.database.client.staffProfile.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'INVITED'] },
        tenant: { status: 'ACTIVE', deletedAt: null },
      },
      select: { tenantId: true },
    });

    await this.database.client.$transaction(async (tx) => {
      await tx.verificationChallenge.update({
        where: { id: challenge.id },
        data: {
          verifiedAt: now,
          consumedAt: now,
        },
      });

      await tx.identity.updateMany({
        where: {
          userId,
          type: challenge.channel === 'EMAIL' ? 'EMAIL' : 'PHONE',
          normalizedValue: challenge.target,
          verifiedAt: null,
        },
        data: {
          verifiedAt: now,
        },
      });

      const registrations = await tx.registration.findMany({
        where: {
          userId,
          ...(staffProfile ? { tenantId: staffProfile.tenantId, type: 'TENANT' as const } : {}),
          status: {
            in: ['INITIATED', 'VERIFICATION_REQUIRED'],
          },
        },
        select: {
          id: true,
        },
      });

      for (const registration of registrations) {
        await tx.registration.update({
          where: { id: registration.id },
          data: {
            verificationStatus: 'VERIFIED',
            ...(!staffProfile
              ? { status: 'ONBOARDING' as const, onboardingStatus: 'IN_PROGRESS' as const }
              : {}),
          },
        });
      }
    });

    return {
      verified: true,
      channel: challenge.channel,
      challengeId: challenge.id,
      verificationStatus: 'VERIFIED',
      registrationStatus: staffProfile ? 'VERIFICATION_REQUIRED' : 'ONBOARDING',
      ...(staffProfile ? { adminApprovalRequired: true } : {}),
    };
  }
}
