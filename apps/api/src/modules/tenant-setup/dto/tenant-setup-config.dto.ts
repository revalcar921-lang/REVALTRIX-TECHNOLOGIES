import {
  IsBoolean,
  IsDateString,
  IsEnum,
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
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { OwnershipEvidenceType, OwnershipPartyRole, OwnershipPartyType, TenantDocumentType } from '@prisma/client';

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

export class SaveOwnershipPartyDto {
  @IsEnum(OwnershipPartyType)
  partyType!: OwnershipPartyType;

  @IsEnum(OwnershipPartyRole)
  role!: OwnershipPartyRole;

  @IsString()
  @MinLength(2)
  @MaxLength(250)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationCountry?: string;

  @IsOptional()
  @IsIn(['NATIONAL_ID', 'PASSPORT', 'ALIEN_ID', 'DRIVING_LICENSE'])
  @MaxLength(50)
  identityDocumentType?: string;
}

export class UploadOwnershipEvidenceDto {
  @IsEnum(OwnershipEvidenceType)
  evidenceType!: OwnershipEvidenceType;
}

export class SubmitOwnershipDeclarationDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  accepted!: boolean;
}

export class ReviewOwnershipPartyDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  decision!: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ReviewTenantDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  decision!: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ReviewTenantActivationDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
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