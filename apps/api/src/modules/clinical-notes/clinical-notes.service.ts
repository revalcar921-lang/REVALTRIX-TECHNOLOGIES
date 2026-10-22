import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalNoteStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../../database/database.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AmendClinicalNoteDto } from './dto/amend-clinical-note.dto.js';
import { CreateClinicalNoteDto } from './dto/create-clinical-note.dto.js';
import { UpdateClinicalNoteDto } from './dto/update-clinical-note.dto.js';
import { VoidClinicalNoteDto } from './dto/void-clinical-note.dto.js';

@Injectable()
export class ClinicalNotesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(userId: string, dto: CreateClinicalNoteDto) {
    const context = await this.authorization.getContext(userId);

    const patient = await this.database.client.patientTenantRecord.findFirst({
      where: {
        id: dto.patientTenantRecordId,
        tenantId: context.tenantId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        patientNumber: true,
      },
    });

    if (!patient) {
      throw new NotFoundException('Patient record not found');
    }

    const encounter = await this.database.client.encounter.findFirst({
      where: {
        id: dto.encounterId,
        tenantId: context.tenantId,
        patientTenantRecordId: patient.id,
      },
      select: {
        id: true,
        encounterNumber: true,
        status: true,
        branchId: true,
        departmentId: true,
        providerId: true,
      },
    });

    if (!encounter) {
      throw new NotFoundException(
        'Encounter not found for this patient record',
      );
    }

    if (
      encounter.status === 'CANCELLED' ||
      encounter.status === 'NO_SHOW'
    ) {
      throw new ConflictException(
        `Clinical notes cannot be created for an ${encounter.status.toLowerCase()} encounter`,
      );
    }

    if (dto.authorProviderId) {
      const provider = await this.database.client.providerProfile.findFirst({
        where: {
          id: dto.authorProviderId,
          tenantId: context.tenantId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
        },
      });

      if (!provider) {
        throw new NotFoundException('Author provider not found');
      }
    }

    const noteNumber = `NOTE-${new Date().getUTCFullYear()}-${randomUUID()}`;

    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          const note = await transaction.clinicalNote.create({
            data: {
              tenantId: context.tenantId,
              patientTenantRecordId: patient.id,
              encounterId: encounter.id,
              authorUserId: userId,
              authorProviderId: dto.authorProviderId ?? null,
              noteNumber,
              type: dto.type,
              status: ClinicalNoteStatus.DRAFT,
              chiefComplaint: dto.chiefComplaint?.trim() || null,
              subjective: dto.subjective?.trim() || null,
              objective: dto.objective?.trim() || null,
              assessment: dto.assessment?.trim() || null,
              plan: dto.plan?.trim() || null,
            },
            select: this.noteSelect(),
          });

          await transaction.clinicalNoteVersion.create({
            data: {
              clinicalNoteId: note.id,
              tenantId: context.tenantId,
              versionNumber: 1,
              chiefComplaint: note.chiefComplaint,
              subjective: note.subjective,
              objective: note.objective,
              assessment: note.assessment,
              plan: note.plan,
              createdByUserId: userId,
            },
          });

          await transaction.auditEvent.create({
            data: {
              tenantId: context.tenantId,
              actorUserId: userId,
              branchId: encounter.branchId ?? context.branchId,
              action: 'CLINICAL_NOTE_CREATED',
              resourceType: 'CLINICAL_NOTE',
              resourceId: note.id,
              outcome: 'SUCCESS',
              reason: 'Clinical note created',
              metadata: {
                noteNumber: note.noteNumber,
                patientTenantRecordId: patient.id,
                patientNumber: patient.patientNumber,
                encounterId: encounter.id,
                encounterNumber: encounter.encounterNumber,
                type: note.type,
                authorProviderId: note.authorProviderId,
              },
            },
          });

          return note;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Clinical note number already exists',
        );
      }

      throw error;
    }
  }

  async list(userId: string, encounterId: string) {
    const context = await this.authorization.getContext(userId);

    const encounter = await this.database.client.encounter.findFirst({
      where: {
        id: encounterId,
        tenantId: context.tenantId,
      },
      select: {
        id: true,
        encounterNumber: true,
      },
    });

    if (!encounter) {
      throw new NotFoundException('Encounter not found');
    }

    const notes = await this.database.client.clinicalNote.findMany({
      where: {
        tenantId: context.tenantId,
        encounterId: encounter.id,
      },
      select: this.noteSelect(),
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      encounter: {
        id: encounter.id,
        encounterNumber: encounter.encounterNumber,
      },
      data: notes,
    };
  }

  async getById(userId: string, clinicalNoteId: string) {
    const context = await this.authorization.getContext(userId);

    const note = await this.database.client.clinicalNote.findFirst({
      where: {
        id: clinicalNoteId,
        tenantId: context.tenantId,
      },
      select: this.noteSelect(),
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    return note;
  }

  async getVersions(userId: string, clinicalNoteId: string) {
    const context = await this.authorization.getContext(userId);

    const note = await this.database.client.clinicalNote.findFirst({
      where: {
        id: clinicalNoteId,
        tenantId: context.tenantId,
      },
      select: {
        id: true,
        noteNumber: true,
        encounterId: true,
        status: true,
      },
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    const versions =
      await this.database.client.clinicalNoteVersion.findMany({
        where: {
          clinicalNoteId: note.id,
          tenantId: context.tenantId,
        },
        select: {
          id: true,
          versionNumber: true,
          chiefComplaint: true,
          subjective: true,
          objective: true,
          assessment: true,
          plan: true,
          createdByUserId: true,
          amendmentReason: true,
          signedAt: true,
          finalizedAt: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: {
          versionNumber: 'asc',
        },
      });

    return {
      note: {
        id: note.id,
        noteNumber: note.noteNumber,
        encounterId: note.encounterId,
        status: note.status,
      },
      data: versions,
    };
  }

  async update(
    userId: string,
    clinicalNoteId: string,
    dto: UpdateClinicalNoteDto,
  ) {
    const context = await this.authorization.getContext(userId);

    const note = await this.database.client.clinicalNote.findFirst({
      where: {
        id: clinicalNoteId,
        tenantId: context.tenantId,
      },
      select: {
        id: true,
        status: true,
        authorUserId: true,
        noteNumber: true,
      },
    });

    if (!note) {
      throw new NotFoundException('Clinical note not found');
    }

    if (note.status !== ClinicalNoteStatus.DRAFT) {
      throw new ConflictException(
        'Only draft clinical notes can be edited',
      );
    }

    if (note.authorUserId !== userId) {
      throw new ConflictException(
        'Only the clinical note author can edit a draft',
      );
    }

    const updateData: Prisma.ClinicalNoteUpdateInput = {};

    if (dto.chiefComplaint !== undefined) {
      updateData.chiefComplaint = dto.chiefComplaint.trim() || null;
    }

    if (dto.subjective !== undefined) {
      updateData.subjective = dto.subjective.trim() || null;
    }

    if (dto.objective !== undefined) {
      updateData.objective = dto.objective.trim() || null;
    }

    if (dto.assessment !== undefined) {
      updateData.assessment = dto.assessment.trim() || null;
    }

    if (dto.plan !== undefined) {
      updateData.plan = dto.plan.trim() || null;
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException(
        'At least one clinical note field is required',
      );
    }

    const updated = await this.database.client.clinicalNote.update({
      where: {
        id: note.id,
      },
      data: updateData,
      select: this.noteSelect(),
    });

    await this.database.client.auditEvent.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: userId,
        branchId: context.branchId,
        action: 'CLINICAL_NOTE_UPDATED',
        resourceType: 'CLINICAL_NOTE',
        resourceId: note.id,
        outcome: 'SUCCESS',
        reason: 'Draft clinical note updated',
        metadata: {
          noteNumber: note.noteNumber,
        },
      },
    });

    return updated;
  }

  async sign(userId: string, clinicalNoteId: string) {
    const context = await this.authorization.getContext(userId);

    return this.database.client.$transaction(
      async (transaction) => {
        const note = await transaction.clinicalNote.findFirst({
          where: {
            id: clinicalNoteId,
            tenantId: context.tenantId,
          },
          select: {
            id: true,
            noteNumber: true,
            status: true,
            authorUserId: true,
            chiefComplaint: true,
            subjective: true,
            objective: true,
            assessment: true,
            plan: true,
          },
        });

        if (!note) {
          throw new NotFoundException('Clinical note not found');
        }

        if (
          note.status !== ClinicalNoteStatus.DRAFT &&
          note.status !== ClinicalNoteStatus.AMENDED
        ) {
          throw new ConflictException(
            `Clinical note cannot be signed from ${note.status}`,
          );
        }

        if (note.authorUserId !== userId) {
          throw new ConflictException(
            'Only the clinical note author can sign the note',
          );
        }

        const now = new Date();

        const updated = await transaction.clinicalNote.update({
          where: {
            id: note.id,
          },
          data: {
            status: ClinicalNoteStatus.SIGNED,
            signedAt: now,
          },
          select: this.noteSelect(),
        });

        const latestVersion =
          await transaction.clinicalNoteVersion.findFirst({
            where: {
              clinicalNoteId: note.id,
              tenantId: context.tenantId,
            },
            orderBy: {
              versionNumber: 'desc',
            },
            select: {
              versionNumber: true,
            },
          });

        const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;

        await transaction.clinicalNoteVersion.create({
          data: {
            clinicalNoteId: note.id,
            tenantId: context.tenantId,
            versionNumber: nextVersion,
            chiefComplaint: note.chiefComplaint,
            subjective: note.subjective,
            objective: note.objective,
            assessment: note.assessment,
            plan: note.plan,
            createdByUserId: userId,
            signedAt: now,
          },
        });

        await transaction.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: context.branchId,
            action: 'CLINICAL_NOTE_SIGNED',
            resourceType: 'CLINICAL_NOTE',
            resourceId: note.id,
            outcome: 'SUCCESS',
            reason: 'Clinical note signed',
            metadata: {
              noteNumber: note.noteNumber,
            },
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async finalize(userId: string, clinicalNoteId: string) {
    const context = await this.authorization.getContext(userId);

    return this.database.client.$transaction(
      async (transaction) => {
        const note = await transaction.clinicalNote.findFirst({
          where: {
            id: clinicalNoteId,
            tenantId: context.tenantId,
          },
          select: {
            id: true,
            noteNumber: true,
            status: true,
            authorUserId: true,
          },
        });

        if (!note) {
          throw new NotFoundException('Clinical note not found');
        }

        if (note.status !== ClinicalNoteStatus.SIGNED) {
          throw new ConflictException(
            `Only signed clinical notes can be finalized; current status is ${note.status}`,
          );
        }

        if (note.authorUserId !== userId) {
          throw new ConflictException(
            'Only the clinical note author can finalize the note',
          );
        }

        const now = new Date();

        const updated = await transaction.clinicalNote.update({
          where: {
            id: note.id,
          },
          data: {
            status: ClinicalNoteStatus.FINAL,
            finalizedAt: now,
          },
          select: this.noteSelect(),
        });

        const latestVersion =
          await transaction.clinicalNoteVersion.findFirst({
            where: {
              clinicalNoteId: note.id,
              tenantId: context.tenantId,
            },
            orderBy: {
              versionNumber: 'desc',
            },
            select: {
              versionNumber: true,
            },
          });

        const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;

        await transaction.clinicalNoteVersion.create({
          data: {
            clinicalNoteId: note.id,
            tenantId: context.tenantId,
            versionNumber: nextVersion,
            chiefComplaint: updated.chiefComplaint,
            subjective: updated.subjective,
            objective: updated.objective,
            assessment: updated.assessment,
            plan: updated.plan,
            createdByUserId: userId,
            signedAt: updated.signedAt,
            finalizedAt: now,
          },
        });

        await transaction.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: context.branchId,
            action: 'CLINICAL_NOTE_FINALIZED',
            resourceType: 'CLINICAL_NOTE',
            resourceId: note.id,
            outcome: 'SUCCESS',
            reason: 'Clinical note finalized',
            metadata: {
              noteNumber: note.noteNumber,
            },
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async amend(
    userId: string,
    clinicalNoteId: string,
    dto: AmendClinicalNoteDto,
  ) {
    const context = await this.authorization.getContext(userId);

    return this.database.client.$transaction(
      async (transaction) => {
        const note = await transaction.clinicalNote.findFirst({
          where: {
            id: clinicalNoteId,
            tenantId: context.tenantId,
          },
          select: {
            id: true,
            noteNumber: true,
            status: true,
            authorUserId: true,
            chiefComplaint: true,
            subjective: true,
            objective: true,
            assessment: true,
            plan: true,
            signedAt: true,
            finalizedAt: true,
          },
        });

        if (!note) {
          throw new NotFoundException('Clinical note not found');
        }

        if (
          note.status !== ClinicalNoteStatus.FINAL &&
          note.status !== ClinicalNoteStatus.AMENDED
        ) {
          throw new ConflictException(
            'Only finalized clinical notes can be amended',
          );
        }

        if (note.authorUserId !== userId) {
          throw new ConflictException(
            'Only the clinical note author can amend the note',
          );
        }

        const latestVersion =
          await transaction.clinicalNoteVersion.findFirst({
            where: {
              clinicalNoteId: note.id,
              tenantId: context.tenantId,
            },
            orderBy: {
              versionNumber: 'desc',
            },
            select: {
              versionNumber: true,
            },
          });

        const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;

        const chiefComplaint =
          dto.chiefComplaint === undefined
            ? note.chiefComplaint
            : dto.chiefComplaint.trim() || null;

        const subjective =
          dto.subjective === undefined
            ? note.subjective
            : dto.subjective.trim() || null;

        const objective =
          dto.objective === undefined
            ? note.objective
            : dto.objective.trim() || null;

        const assessment =
          dto.assessment === undefined
            ? note.assessment
            : dto.assessment.trim() || null;

        const plan =
          dto.plan === undefined
            ? note.plan
            : dto.plan.trim() || null;

        const updated = await transaction.clinicalNote.update({
          where: {
            id: note.id,
          },
          data: {
            status: ClinicalNoteStatus.AMENDED,
            chiefComplaint,
            subjective,
            objective,
            assessment,
            plan,
            signedAt: null,
            finalizedAt: null,
          },
          select: this.noteSelect(),
        });

        await transaction.clinicalNoteVersion.create({
          data: {
            clinicalNoteId: note.id,
            tenantId: context.tenantId,
            versionNumber: nextVersion,
            chiefComplaint,
            subjective,
            objective,
            assessment,
            plan,
            createdByUserId: userId,
            amendmentReason:
              dto.amendmentReason?.trim() || 'Clinical note amended',
            signedAt: null,
            finalizedAt: null,
          },
        });

        await transaction.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: context.branchId,
            action: 'CLINICAL_NOTE_AMENDED',
            resourceType: 'CLINICAL_NOTE',
            resourceId: note.id,
            outcome: 'SUCCESS',
            reason:
              dto.amendmentReason?.trim() || 'Clinical note amended',
            metadata: {
              noteNumber: note.noteNumber,
              versionNumber: nextVersion,
            },
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async void(
    userId: string,
    clinicalNoteId: string,
    dto: VoidClinicalNoteDto,
  ) {
    const context = await this.authorization.getContext(userId);
    const reason = dto.reason.trim();

    if (!reason) {
      throw new BadRequestException('Void reason is required');
    }

    return this.database.client.$transaction(
      async (transaction) => {
        const note = await transaction.clinicalNote.findFirst({
          where: {
            id: clinicalNoteId,
            tenantId: context.tenantId,
          },
          select: {
            id: true,
            noteNumber: true,
            status: true,
              },
        });

        if (!note) {
          throw new NotFoundException('Clinical note not found');
        }

        if (note.status === ClinicalNoteStatus.VOID) {
          throw new ConflictException('Clinical note is already void');
        }

        if (note.status === ClinicalNoteStatus.DRAFT) {
          throw new ConflictException(
            'Draft clinical notes must be discarded through a separate workflow',
          );
        }

        const now = new Date();

        const updated = await transaction.clinicalNote.update({
          where: {
            id: note.id,
          },
          data: {
            status: ClinicalNoteStatus.VOID,
            voidedAt: now,
            voidReason: reason,
          },
          select: this.noteSelect(),
        });

        await transaction.auditEvent.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: userId,
            branchId: context.branchId,
            action: 'CLINICAL_NOTE_VOIDED',
            resourceType: 'CLINICAL_NOTE',
            resourceId: note.id,
            outcome: 'SUCCESS',
            reason,
            metadata: {
              noteNumber: note.noteNumber,
              previousStatus: note.status,
            },
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private noteSelect() {
    return {
      id: true,
      tenantId: true,
      patientTenantRecordId: true,
      encounterId: true,
      authorUserId: true,
      authorProviderId: true,
      noteNumber: true,
      type: true,
      status: true,
      chiefComplaint: true,
      subjective: true,
      objective: true,
      assessment: true,
      plan: true,
      signedAt: true,
      finalizedAt: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      updatedAt: true,
      encounter: {
        select: {
          id: true,
          encounterNumber: true,
        },
      },
    } satisfies Prisma.ClinicalNoteSelect;
  }
}
