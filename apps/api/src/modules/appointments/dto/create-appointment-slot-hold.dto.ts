import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAppointmentSlotHoldDto {
  @IsUUID('4')
  tenantId!: string;

  @IsUUID('4')
  serviceId!: string;

  @IsUUID('4')
  providerId!: string;

  @IsUUID('4')
  branchId!: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @IsDateString({ strict: true })
  startAt!: string;

  @IsDateString({ strict: true })
  endAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timeZone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsString()
  @MinLength(24)
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;
}

export class InitiateAppointmentDepositDto {
  @IsString()
  @MinLength(24)
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;

  @IsString()
  @MinLength(9)
  @MaxLength(16)
  phoneNumber!: string;
}