import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AppointmentDiscoveryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}