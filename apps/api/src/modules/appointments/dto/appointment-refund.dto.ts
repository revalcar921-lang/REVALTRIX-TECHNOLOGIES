import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestAppointmentRefundDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class ReviewAppointmentRefundDto {
  @IsIn(['PENDING', 'REFUNDED', 'FAILED', 'DISPUTED', 'NOT_ELIGIBLE'])
  status!: 'PENDING' | 'REFUNDED' | 'FAILED' | 'DISPUTED' | 'NOT_ELIGIBLE';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidenceRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerReference?: string;

  @IsOptional()
  @IsIn(['CASH', 'MPESA', 'BANK_TRANSFER', 'OTHER'])
  refundMethod?: 'CASH' | 'MPESA' | 'BANK_TRANSFER' | 'OTHER';
}