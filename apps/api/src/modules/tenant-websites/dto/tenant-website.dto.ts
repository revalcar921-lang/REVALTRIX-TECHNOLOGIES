import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TenantWebsiteFaqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  question!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  answer!: string;
}

export class UpdateTenantWebsiteDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  heroTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  heroDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-f]{6}$/i)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-f]{6}$/i)
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  heroImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  @MaxLength(320)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emergencyPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  emergencyMessage?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  facebookUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  instagramUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  seoDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  openGraphTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  openGraphDescription?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  canonicalUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  socialShareImageUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  faviconUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  googleBusinessProfileUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  providerIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TenantWebsiteFaqDto)
  faqs?: TenantWebsiteFaqDto[];
}

export class CreateTenantWebsiteEnquiryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class UpdateTenantWebsiteEnquiryDto {
  @IsIn(['READ', 'RESOLVED'])
  status!: 'READ' | 'RESOLVED';
}

export class TenantWebsiteSlotSearchDto {
  @IsUUID('4')
  serviceId!: string;

  @IsOptional()
  @IsUUID('4')
  providerId?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @IsDateString({ strict: true })
  from!: string;

  @IsDateString({ strict: true })
  to!: string;
}

export class TenantWebsiteAppointmentDto {
  @IsUUID('4')
  serviceId!: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string;

  @IsUUID('4')
  providerId!: string;

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
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  patientNotes?: string;
}