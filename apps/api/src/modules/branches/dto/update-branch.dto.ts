import {
  IsArray,
  IsEmail,
  IsOptional,
  Matches,
  IsString,
  IsUUID,
  IsNumber,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  town?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  county?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openingTime?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closingTime?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatingDays?: string[];

  @IsOptional()
  @IsUUID()
  organizationId?: string | null;
}
