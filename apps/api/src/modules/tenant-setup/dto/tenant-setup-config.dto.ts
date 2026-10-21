import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantDocumentType } from '@prisma/client';

export class UploadTenantDocumentDto {
  @IsIn(['BUSINESS_PERMIT', 'HEALTHCARE_FACILITY_LICENSE', 'REGISTRATION_CERTIFICATE', 'INCORPORATION_CERTIFICATE'])
  type!: TenantDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuingAuthority?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class UpdateBookingPolicyDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  minLeadTimeMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  cancellationWindowHours!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  rescheduleWindowHours!: number;

  @IsBoolean()
  noShowFeeEnabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxBookingsPerDay!: number;

  @IsBoolean()
  allowOnlineBooking!: boolean;
}

export class UpdateOrganizationPaymentConfigDto {
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsBoolean()
  acceptMpesa!: boolean;

  @IsBoolean()
  acceptCard!: boolean;

  @IsBoolean()
  acceptBankTransfer!: boolean;

  @IsBoolean()
  acceptCash!: boolean;

  @IsBoolean()
  depositRequired!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  depositPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mpesaPaybill?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccountNumber?: string;
}

export class CreateOperationalResourceDto {
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsIn(['ROOM', 'EQUIPMENT', 'BED', 'VEHICLE', 'OTHER'])
  type!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  capacity!: number;
}

export class AcceptTenantTermsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  version!: string;

  @IsBoolean()
  accepted!: boolean;
}